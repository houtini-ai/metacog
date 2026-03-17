/**
 * Vestibular - Action Diversity (Priority 5: Orientation)
 *
 * Detects when the agent is going in circles - repeating the same
 * searches, reading the same files, running the same commands.
 *
 * Like the vestibular system detecting spinning: the individual
 * movements feel purposeful, but the trajectory is circular.
 */

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @returns {string|null} - Signal message or null if normal
 */
export function evaluate(state, action, config) {
  const { vestibular } = config;

  const recent = state.actions.slice(-(vestibular.consecutive_similar + 1));
  if (recent.length < vestibular.consecutive_similar) return null;

  // Check 1: Consecutive similar actions (same tool + similar target)
  const tail = recent.slice(-vestibular.consecutive_similar);
  const allSimilar = tail.every(a =>
    a.tool_name === action.tool_name &&
    targetSimilarity(a.target_resource, action.target_resource) >= vestibular.action_similarity
  );

  if (allSimilar && action.exit_status !== 'error') {
    // Don't fire if errors are happening - nociception handles that
    return `You have performed ${vestibular.consecutive_similar} consecutive similar ${action.tool_name} actions. You may be searching in circles.`;
  }

  // Check 2: Re-reading files already read earlier in the session
  if (action.action_type === 'read' && action.target_resource !== 'unknown') {
    const earlierReads = state.actions.slice(0, -3).filter(a =>
      a.action_type === 'read' &&
      a.target_resource === action.target_resource
    );

    if (earlierReads.length >= 2) {
      return `You have read ${basename(action.target_resource)} ${earlierReads.length + 1} times this session. If previous reads were lost to compaction, summarise findings to a file before re-reading.`;
    }
  }

  return null;
}

/**
 * Compute similarity between two target resource strings.
 * Exact match = 1.0, completely different = 0.0.
 */
function targetSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1.0;

  // For file paths, check if they share a directory or similar name
  const tokensA = a.split(/[/\\.\s-]+/).filter(Boolean);
  const tokensB = b.split(/[/\\.\s-]+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter(x => setB.has(x));
  const union = new Set([...setA, ...setB]);

  return intersection.length / union.size;
}

function basename(path) {
  if (!path) return 'unknown';
  return path.split(/[/\\]/).pop() || path;
}
