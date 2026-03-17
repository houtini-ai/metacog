/**
 * State management for Metacog PNS
 *
 * Manages the rolling action window stored as an ephemeral JSON file.
 * This is the agent's "short-term sensory memory" - it holds the last N
 * actions to enable proprioceptive signal calculation.
 *
 * Zero dependencies. Pure Node.js.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const MAX_WINDOW_SIZE = 20;

/**
 * Default empty state
 */
function emptyState() {
  return {
    session_id: null,
    session_start: null,
    actions: [],
    baseline: {
      established: false,
      avg_token_velocity: 0,
      turns_sampled: 0,
    },
    nociception: {
      escalation_level: 0,       // 0=none, 1=socratic, 2=directive, 3=user-escalation
      cooldown_remaining: 0,     // turns until next intervention allowed
      last_intervention_at: null, // action index of last Layer 2 fire
    },
    turn_count: 0,
    last_user_interaction: null,  // ISO timestamp of last user message
  };
}

/**
 * Read state from file. Returns empty state if file doesn't exist.
 */
export function readState(statePath) {
  try {
    const raw = readFileSync(statePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return emptyState();
  }
}

/**
 * Write state to file. Creates directories if needed.
 */
export function writeState(statePath, state) {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    // State write failure is non-fatal - we degrade gracefully
    process.stderr.write(`[metacog] state write error: ${err.message}\n`);
  }
}

/**
 * Estimate token count from text. Rough heuristic: ~4 chars per token.
 * Intentionally imprecise - we use trends, not absolutes.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.ceil(str.length / 4);
}

/**
 * Create an action record from hook input
 */
export function createAction(hookInput, tokenEstimate) {
  const now = new Date().toISOString();

  // Extract error signature - a rough fingerprint of error output
  const toolResult = hookInput.tool_result || '';
  const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
  const isError = detectError(resultStr, hookInput);
  const errorSignature = isError ? computeErrorSignature(resultStr) : null;

  return {
    tool_name: hookInput.tool_name || 'unknown',
    target_resource: extractTarget(hookInput),
    action_type: classifyAction(hookInput.tool_name),
    exit_status: isError ? 'error' : 'success',
    error_signature: errorSignature,
    token_estimate: tokenEstimate,
    timestamp: now,
  };
}

/**
 * Append action to state, maintaining rolling window
 */
export function appendAction(state, action, sessionId) {
  // Reset state if session changed
  if (state.session_id !== sessionId) {
    state = emptyState();
    state.session_id = sessionId;
    state.session_start = new Date().toISOString();
    state.last_user_interaction = new Date().toISOString();
  }

  state.actions.push(action);
  state.turn_count++;

  // Trim to window size
  if (state.actions.length > MAX_WINDOW_SIZE) {
    state.actions = state.actions.slice(-MAX_WINDOW_SIZE);
  }

  // Update baseline (first 10 turns)
  if (state.baseline.turns_sampled < 10) {
    const n = state.baseline.turns_sampled;
    state.baseline.avg_token_velocity =
      (state.baseline.avg_token_velocity * n + action.token_estimate) / (n + 1);
    state.baseline.turns_sampled = n + 1;
    if (state.baseline.turns_sampled >= 10) {
      state.baseline.established = true;
    }
  }

  // Tick cooldown
  if (state.nociception.cooldown_remaining > 0) {
    state.nociception.cooldown_remaining--;
  }

  return state;
}

// --- Internal helpers ---

function detectError(resultStr, hookInput) {
  if (!resultStr) return false;

  // Check for common error patterns
  const errorPatterns = [
    /error:/i,
    /Error:/,
    /ERROR/,
    /failed/i,
    /command not found/i,
    /no such file/i,
    /permission denied/i,
    /ENOENT/,
    /EACCES/,
    /SyntaxError/,
    /TypeError/,
    /ReferenceError/,
    /Cannot find module/,
    /exit code [1-9]/i,
    /non-zero exit/i,
  ];

  return errorPatterns.some(p => p.test(resultStr));
}

/**
 * Compute a rough error signature for similarity comparison.
 * Strips variable parts (paths, line numbers, timestamps) and
 * keeps the structural shape of the error.
 */
function computeErrorSignature(errorText) {
  if (!errorText) return '';

  return errorText
    .slice(0, 500)                           // cap length
    .replace(/\d+/g, 'N')                    // normalize numbers
    .replace(/['"`].*?['"`]/g, 'STR')        // normalize strings
    .replace(/\/[\w./\\-]+/g, 'PATH')        // normalize paths
    .replace(/\s+/g, ' ')                    // normalize whitespace
    .trim()
    .toLowerCase();
}

/**
 * Extract the primary target resource from tool input
 */
function extractTarget(hookInput) {
  const input = hookInput.tool_input || {};

  // Common tool input field names for file paths
  return input.file_path
    || input.path
    || input.command?.slice(0, 100)  // truncated command for Bash
    || input.pattern                  // for Grep/Glob
    || 'unknown';
}

/**
 * Classify tool action type
 */
function classifyAction(toolName) {
  const writes = ['Edit', 'Write', 'NotebookEdit'];
  const executes = ['Bash', 'Agent'];
  const reads = ['Read', 'Grep', 'Glob'];

  if (writes.includes(toolName)) return 'write';
  if (executes.includes(toolName)) return 'execute';
  if (reads.includes(toolName)) return 'read';
  return 'other';
}
