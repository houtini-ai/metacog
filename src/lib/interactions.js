/**
 * User Interaction Analysis for Metacog
 *
 * Tracks how the user collaborates with the agent across sessions.
 * Not surveillance — collaborative insight. The goal is to help
 * both sides work more effectively together.
 *
 * Tracks:
 *   - Prompt specificity (mentions files, functions, line numbers?)
 *   - Interaction frequency (tool calls between user messages)
 *   - Signal responsiveness (did the user check in after signals fired?)
 *
 * All data is stored in the ephemeral state file and the cross-session
 * learnings JSONL. Nothing is sent externally.
 */

const MAX_INTERACTION_HISTORY = 20;

/**
 * Analyze a user prompt for specificity and quality signals.
 *
 * High specificity = mentions files, functions, line numbers, error messages.
 * Low specificity = vague instructions like "fix the tests" or "make it work".
 *
 * This is NOT a quality judgment — vague prompts are appropriate for
 * exploratory work. The signal matters when correlated with session length.
 *
 * @param {string} promptText - The user's message
 * @returns {object} - Analysis result
 */
export function analyzePrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return { specificity: 0, length: 0, hasPath: false, hasLineRef: false, hasErrorText: false };
  }

  const text = promptText.trim();
  let specificity = 0;

  // File path references (strong specificity signal)
  const hasPath = /(?:[./\\][\w./\\-]+\.[\w]+)/.test(text);
  if (hasPath) specificity += 0.3;

  // Line number references
  const hasLineRef = /(?:line\s*\d+|:\d+|L\d+)/i.test(text);
  if (hasLineRef) specificity += 0.2;

  // Function/class/method names (camelCase, snake_case, etc.)
  const hasIdentifier = /\b[a-z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+\b/.test(text) ||
                        /\b[a-z]+_[a-z]+\b/.test(text);
  if (hasIdentifier) specificity += 0.2;

  // Error messages or stack traces
  const hasErrorText = /(?:error|exception|traceback|stack|failed|undefined is not)/i.test(text) &&
                       text.length > 50;
  if (hasErrorText) specificity += 0.2;

  // Quoted specific references
  const hasQuotedRef = /["'`][^"'`]{3,60}["'`]/.test(text);
  if (hasQuotedRef) specificity += 0.1;

  // Length as a weak signal (very short = likely vague)
  if (text.length < 20) specificity *= 0.5;

  return {
    specificity: Math.min(1.0, specificity),
    length: text.length,
    hasPath,
    hasLineRef,
    hasErrorText,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Record a user interaction in session state.
 * Maintains a rolling window of interaction metadata.
 *
 * Also calculates tools_before_next on the PREVIOUS interaction
 * (now that we know how many tool calls happened between messages).
 */
export function recordInteraction(state, analysis, sessionId) {
  if (!state.user_interactions) {
    state.user_interactions = [];
  }

  // Update the previous interaction with tool count
  if (state.user_interactions.length > 0) {
    const prev = state.user_interactions[state.user_interactions.length - 1];
    prev.tools_before_next = state.turn_count - (prev.turn_at || 0);
  }

  // Record this interaction
  state.user_interactions.push({
    ...analysis,
    session_id: sessionId,
    turn_at: state.turn_count,
    signals_active: countActiveSignals(state),
  });

  // Trim to window
  if (state.user_interactions.length > MAX_INTERACTION_HISTORY) {
    state.user_interactions = state.user_interactions.slice(-MAX_INTERACTION_HISTORY);
  }

  // Update last user interaction timestamp (used by Chronos)
  state.last_user_interaction = new Date().toISOString();

  return state;
}

/**
 * Count how many senses were in a signaling state when the user sent their message.
 * Useful for detecting whether users check in *because* of signals.
 */
function countActiveSignals(state) {
  let count = 0;

  // Check cooldowns — if a cooldown is active, that sense recently fired
  if ((state.o2_cooldown || 0) > 0) count++;
  if ((state.vestibular_cooldown || 0) > 0) count++;
  if ((state.echo_cooldown || 0) > 0) count++;
  if ((state.drift_cooldown || 0) > 0) count++;
  if (state.nociception?.escalation_level > 0) count++;
  if ((state._chronos_last_level || 0) > 0) count++;

  return count;
}
