#!/usr/bin/env node

/**
 * Metacog PNS - PostToolUse Hook
 *
 * The autonomic nervous system. Fires silently after every tool call.
 * Calculates proprioceptive signals, injects them ONLY when abnormal.
 *
 * Exit codes:
 *   0 = all senses normal, no output (zero token cost)
 *   2 = signal detected, stderr contains message for Claude
 *
 * Design principles:
 *   - No news is good news (silent when normal)
 *   - Trends over absolutes (honest about measurement limits)
 *   - Inform, don't command (trust the agent's reasoning)
 *   - Graceful degradation (any error → exit 0, agent is just normal Claude)
 */

import { readState, writeState, estimateTokensFromHook, createAction, appendAction } from './lib/state.js';
import { loadConfig } from './lib/config.js';
import { extractMotorLearning, persistLearnings } from './lib/learnings.js';
import { evaluate as evaluateO2 } from './senses/o2.js';
import { evaluate as evaluateChronos } from './senses/chronos.js';
import { evaluate as evaluateNociception, checkResolution } from './senses/nociception.js';
import { evaluate as evaluateSpatial } from './senses/spatial.js';
import { evaluate as evaluateVestibular } from './senses/vestibular.js';
import { join } from 'path';

async function main() {
  try {
    // Read hook input from stdin
    const input = await readStdin();
    const hookInput = JSON.parse(input);

    const cwd = hookInput.cwd || process.cwd();
    const sessionId = hookInput.session_id || 'unknown';

    // Paths
    const statePath = join(cwd, '.claude', 'metacog.state.json');

    // Load config and state
    const config = loadConfig(cwd);
    let state = readState(statePath);

    // Estimate tokens from both tool input and result (both consume context)
    const tokenEstimate = estimateTokensFromHook(hookInput);

    // Create action record
    const action = createAction(hookInput, tokenEstimate);

    // Derive project scope from cwd (.claude dir within the project)
    const projectScope = join(cwd, '.claude');

    // Append to rolling window (passes project scope for per-project learnings)
    state = appendAction(state, action, sessionId, projectScope, config);

    // --- Evaluate all 5 senses ---
    const signals = [];

    // 1. O2 - Context Trend
    const o2Signal = evaluateO2(state, action, config.proprioception);
    if (o2Signal) signals.push({ sense: 'O2', message: o2Signal });

    // 2. Chronos - Temporal Awareness
    const chronosSignal = evaluateChronos(state, action, config.proprioception);
    if (chronosSignal) signals.push({ sense: 'Chronos', message: chronosSignal });

    // 3. Nociception - Error Friction (has Layer 1 + Layer 2)
    const nociResult = evaluateNociception(state, action, config.proprioception);
    if (nociResult.signal) signals.push({ sense: 'Nociception', message: nociResult.signal });

    // 4. Spatial - Blast Radius
    const spatialSignal = evaluateSpatial(state, action, config.proprioception, cwd);
    if (spatialSignal) signals.push({ sense: 'Spatial', message: spatialSignal });

    // 5. Vestibular - Action Diversity
    const vestibularSignal = evaluateVestibular(state, action, config.proprioception);
    if (vestibularSignal) signals.push({ sense: 'Vestibular', message: vestibularSignal });

    // --- Check for nociceptive resolution (Layer 3: Motor Learning) ---
    if (checkResolution(state)) {
      // Nociceptive event resolved - extract what changed and persist the lesson
      try {
        const motorLearning = extractMotorLearning(state);
        if (motorLearning) {
          persistLearnings([motorLearning], projectScope);
        }
      } catch {
        // Motor learning extraction is non-fatal
      }
      state.nociception.escalation_level = 0;
    }

    // --- Decide what to output ---

    // Layer 2: Nociceptive interrupt takes priority
    if (nociResult.layer2) {
      state.nociception.escalation_level++;
      state.nociception.cooldown_remaining = config.nociception.escalation_cooldown;
      state.nociception.last_intervention_at = state.turn_count;

      // Save state before outputting
      writeState(statePath, state);

      // Layer 2 interrupt - includes Layer 1 signals as context
      const output = formatLayer2(nociResult.layer2, signals);
      process.stderr.write(output);
      process.exit(2);
    }

    // Layer 1: Proprioceptive signals (if any)
    if (signals.length > 0) {
      writeState(statePath, state);

      const output = formatLayer1(signals);
      process.stderr.write(output);
      process.exit(2);
    }

    // All clear - save state and exit silently
    writeState(statePath, state);
    process.exit(0);

  } catch (err) {
    // Graceful degradation: ANY error → exit 0
    // The agent is just normal Claude without proprioception
    // Don't let the nervous system kill the brain
    process.exit(0);
  }
}

// --- Formatting ---

function formatLayer1(signals) {
  const lines = ['[Proprioception]'];
  for (const s of signals) {
    lines.push(`${s.message}`);
  }
  return lines.join('\n');
}

function formatLayer2(intervention, signals) {
  const lines = ['[NOCICEPTIVE INTERRUPT]'];

  // Include any active Layer 1 signals as context
  const otherSignals = signals.filter(s => s.sense !== 'Nociception');
  if (otherSignals.length > 0) {
    lines.push('');
    lines.push('Current sensory state:');
    for (const s of otherSignals) {
      lines.push(`  - ${s.sense}: ${s.message}`);
    }
    lines.push('');
  }

  lines.push(intervention);
  return lines.join('\n');
}

// --- Stdin reader ---

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);

    // Safety timeout - don't hang if stdin never closes
    setTimeout(() => resolve(data), 2000);
  });
}

main();
