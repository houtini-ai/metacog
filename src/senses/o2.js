/**
 * O2 - Context Trend (Priority 1: Survival)
 *
 * Detects when the agent is consuming context at an unsustainable rate.
 * Like oxygen awareness - you don't notice breathing until the air runs thin.
 *
 * We measure token VELOCITY, not absolute usage, because we can't know
 * the actual context window size. A velocity spike is honest and measurable.
 */

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @returns {string|null} - Signal message or null if normal
 */
export function evaluate(state, action, config) {
  const { o2 } = config;

  // Can't evaluate until baseline is established
  if (!state.baseline.established) return null;

  const baseline = state.baseline.avg_token_velocity;
  if (baseline <= 0) return null;

  // Calculate recent velocity (last 3 actions)
  const recent = state.actions.slice(-3);
  if (recent.length < 2) return null;

  const recentAvg = recent.reduce((sum, a) => sum + (a.token_estimate || 0), 0) / recent.length;
  const velocityRatio = recentAvg / baseline;

  if (velocityRatio >= o2.velocity_multiplier) {
    // Count large reads specifically
    const largeReads = recent.filter(
      a => a.action_type === 'read' && a.token_estimate > baseline * 2
    ).length;

    const detail = largeReads > 0
      ? `${largeReads} large file read${largeReads > 1 ? 's' : ''} in last ${recent.length} actions`
      : `token consumption at ${velocityRatio.toFixed(1)}x baseline rate`;

    return `Context filling rapidly (${detail}). Consider summarising findings to a scratchpad before proceeding with more reads.`;
  }

  return null;
}
