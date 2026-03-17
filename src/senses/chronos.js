/**
 * Chronos - Temporal Awareness (Priority 2: Efficiency)
 *
 * The agent has no sense of time. A 45-minute task feels identical
 * to a 2-minute task. This sense provides the clock.
 *
 * Triggers when the agent has been working too long without user interaction,
 * giving it the awareness to decide whether to continue or escalate.
 */

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @returns {string|null} - Signal message or null if normal
 */
export function evaluate(state, action, config) {
  const { chronos } = config;

  if (!state.session_start) return null;

  const now = Date.now();
  const lastUserTime = state.last_user_interaction
    ? new Date(state.last_user_interaction).getTime()
    : new Date(state.session_start).getTime();

  const elapsedMs = now - lastUserTime;
  const elapsedMinutes = elapsedMs / 60000;
  const steps = state.turn_count;

  // Calculate which "alert level" we're at (1x, 2x, 3x threshold)
  const timeLevel = Math.floor(elapsedMinutes / chronos.time_threshold_minutes);
  const stepLevel = Math.floor(steps / chronos.step_threshold);
  const currentLevel = Math.max(timeLevel, stepLevel);

  // Don't fire if we haven't crossed any threshold
  if (currentLevel < 1) return null;

  // Track last fired level to avoid repeating
  const lastFired = state._chronos_last_level || 0;
  if (currentLevel <= lastFired) return null;

  // Record that we fired at this level (hook.js will persist this)
  state._chronos_last_level = currentLevel;

  const timeStr = formatDuration(elapsedMs);
  const parts = [];
  if (timeLevel >= 1) parts.push(`T+${timeStr}`);
  parts.push(`${steps} tool calls on current task`);

  return `${parts.join(', ')}. Consider whether to continue independently or check in with the user.`;
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);

  if (mins === 0) return `${secs}s`;
  if (mins < 60) return `${mins}m ${secs}s`;

  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}
