#!/usr/bin/env node

/**
 * Metacog Digest Injector — UserPromptSubmit hook
 *
 * Fires on every user message. Responsibilities:
 *
 *   First message of session:
 *     1. Compiles latest learnings (global + project-scoped)
 *     2. Stores active pattern IDs for reinforcement tracking
 *     3. Builds session retrospective from the prior session
 *     4. Injects digest + retrospective as system message
 *
 *   Every message (including first):
 *     5. Captures task fingerprint for scope drift detection
 *     6. Records user interaction metadata for pattern tracking
 *     7. Updates state with the interaction record
 *
 * Output:
 *   exit 0, no stdout = no output (no learnings, or subsequent message with nothing to say)
 *   exit 0, stdout JSON = digest/retrospective injected via systemMessage
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { compileAndWriteDigest, DIGEST_PATH, CLAUDE_DIR } from './lib/learnings.js';
import { readState, writeState } from './lib/state.js';
import { buildTaskFingerprint } from './senses/drift.js';
import { buildRetrospective } from './lib/retrospective.js';
import { analyzePrompt, recordInteraction } from './lib/interactions.js';

const SESSION_MARKER_PATH = join(CLAUDE_DIR, '.metacog-session-marker');
const ACTIVE_PATTERNS_PATH = join(CLAUDE_DIR, '.metacog-active-patterns.json');

async function main() {
  try {
    // Read hook input
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    const sessionId = hookInput.session_id || 'unknown';
    const cwd = hookInput.cwd || process.cwd();
    const promptText = hookInput.user_message || hookInput.content || '';

    mkdirSync(CLAUDE_DIR, { recursive: true });

    const statePath = join(cwd, '.claude', 'metacog.state.json');
    const projectScope = join(cwd, '.claude');

    // --- Every message: update task fingerprint + record interaction ---
    let state = readState(statePath);

    // Build and store task fingerprint for scope drift detection.
    // Each user message updates the fingerprint — if the user redirects,
    // the fingerprint should track the new direction.
    const fingerprint = buildTaskFingerprint(promptText);
    if (fingerprint.terms.length > 0) {
      state.task_fingerprint = fingerprint;
    }

    // Analyze prompt quality and record the interaction
    const promptAnalysis = analyzePrompt(promptText);
    state = recordInteraction(state, promptAnalysis, sessionId);

    // Persist updated state
    writeState(statePath, state);

    // --- First message only: digest + retrospective ---
    let lastSessionId = null;
    try {
      lastSessionId = readFileSync(SESSION_MARKER_PATH, 'utf-8').trim();
    } catch {
      // No marker = first session ever
    }

    if (lastSessionId === sessionId) {
      // Already injected for this session — exit silently
      process.exit(0);
    }

    // Mark this session
    writeFileSync(SESSION_MARKER_PATH, sessionId, 'utf-8');

    // Build session retrospective from prior session state
    let retroSection = '';
    try {
      retroSection = buildRetrospective(state, projectScope);
    } catch {
      // Retrospective is non-fatal
    }

    // Compile fresh digest (merges global + project-scoped learnings)
    const result = compileAndWriteDigest(projectScope);

    if (result.entries === 0 && !retroSection) {
      // Nothing to inject
      process.exit(0);
    }

    // Persist active pattern IDs for reinforcement tracking
    try {
      writeFileSync(
        ACTIVE_PATTERNS_PATH,
        JSON.stringify({ sessionId, patterns: result.activePatternIds }),
        'utf-8'
      );
    } catch {
      // Non-fatal
    }

    // Build the injection message
    const parts = [];

    if (result.entries > 0) {
      const digest = readFileSync(DIGEST_PATH, 'utf-8');
      parts.push(`[Metacog Behavioral Digest]\n${digest}`);
    }

    if (retroSection) {
      parts.push(retroSection);
    }

    // Include user interaction insights if accumulated
    const interactionInsight = buildInteractionInsight(state);
    if (interactionInsight) {
      parts.push(interactionInsight);
    }

    const output = JSON.stringify({
      continue: true,
      suppressOutput: false,
      systemMessage: parts.join('\n\n---\n\n')
    });
    process.stdout.write(output);
    process.exit(0);

  } catch (err) {
    // Graceful degradation — never break the agent
    process.exit(0);
  }
}

/**
 * Build a brief insight from accumulated user interaction patterns.
 * Only surfaces when there's a clear, actionable pattern.
 */
function buildInteractionInsight(state) {
  const interactions = state.user_interactions || [];
  if (interactions.length < 5) return null; // need history

  // Calculate patterns across recent interactions
  const recent = interactions.slice(-10);
  const avgSpecificity = recent.reduce((s, i) => s + (i.specificity || 0), 0) / recent.length;
  const avgToolsPerPrompt = recent.reduce((s, i) => s + (i.tools_before_next || 0), 0) / recent.length;

  const insights = [];

  if (avgSpecificity < 0.3 && avgToolsPerPrompt > 20) {
    insights.push(
      'Sessions with broader prompts tend to run longer in this project. ' +
      'Mentioning specific files, functions, or line numbers helps the agent converge faster.'
    );
  }

  if (avgToolsPerPrompt > 40) {
    insights.push(
      'Recent prompts averaged ' + Math.round(avgToolsPerPrompt) + ' tool calls each. ' +
      'Consider breaking complex tasks into smaller prompts or adding mid-task check-ins.'
    );
  }

  if (insights.length === 0) return null;

  return '[Metacog — Collaboration Patterns]\n' + insights.join('\n');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    setTimeout(() => resolve(data), 2000);
  });
}

main();
