/**
 * Nociception - Error Friction (Priority 3: Pain)
 *
 * Detects when the agent is struggling - repeated similar errors
 * indicate it's operating on a false assumption. Individual errors
 * are visible, but the PATTERN of repeated failure is not.
 *
 * Key discriminator: Same error = stuck (signal). Different errors = exploring (allow).
 */

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @returns {{ signal: string|null, layer2: string|null }} - Layer 1 and/or Layer 2 signals
 */
export function evaluate(state, action, config) {
  const { nociception } = config;
  const result = { signal: null, layer2: null };

  // In cooldown - suppress all signals
  if (state.nociception.cooldown_remaining > 0) return result;

  const recent = state.actions.slice(-nociception.window_size);
  if (recent.length < 2) return result;

  // Count consecutive errors from the end
  let consecutiveErrors = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].exit_status === 'error') {
      consecutiveErrors++;
    } else {
      break;
    }
  }

  if (consecutiveErrors < 2) return result;

  // Check error similarity - are these the SAME error?
  const errorActions = recent.filter(a => a.exit_status === 'error').slice(-consecutiveErrors);
  const similarity = computeGroupSimilarity(errorActions.map(a => a.error_signature || ''));

  if (consecutiveErrors >= nociception.consecutive_errors && similarity >= nociception.error_similarity) {
    // Layer 1: proprioceptive signal
    result.signal = `Error friction elevated - ${consecutiveErrors} consecutive similar failures.`;

    // Layer 2: check if we need a nociceptive interrupt
    const level = state.nociception.escalation_level;

    if (level === 0) {
      // First intervention: Socratic
      result.layer2 = formatSocratic(consecutiveErrors, errorActions);
    } else if (level === 1) {
      // Second intervention: Directive
      result.layer2 = formatDirective(consecutiveErrors, errorActions);
    } else if (level >= 2) {
      // Third intervention: Escalate to user
      result.layer2 = formatEscalation(consecutiveErrors);
    }
  } else if (consecutiveErrors >= 2 && similarity >= nociception.error_similarity) {
    // Sub-threshold but notable - just Layer 1
    result.signal = `Error friction rising - ${consecutiveErrors} similar failures in the last ${nociception.window_size} actions.`;
  }

  return result;
}

/**
 * Check if a nociceptive event has resolved (errors stopped)
 */
export function checkResolution(state) {
  if (state.nociception.escalation_level === 0) return false;

  const recent = state.actions.slice(-3);
  const allSuccess = recent.length >= 2 && recent.every(a => a.exit_status === 'success');

  return allSuccess;
}

// --- Similarity computation ---

/**
 * Compute average pairwise similarity across a group of error signatures.
 * Uses Jaccard similarity on word tokens - fast and good enough.
 */
function computeGroupSimilarity(signatures) {
  if (signatures.length < 2) return 0;

  let totalSim = 0;
  let pairs = 0;

  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      totalSim += jaccardSimilarity(signatures[i], signatures[j]);
      pairs++;
    }
  }

  return pairs > 0 ? totalSim / pairs : 0;
}

function jaccardSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

// --- Intervention formatting ---

function formatSocratic(errorCount, errorActions) {
  const target = errorActions[0]?.target_resource || 'the current target';
  return [
    `You have attempted ${errorCount} consecutive fixes resulting in similar errors on ${target}.`,
    `You are likely operating on a false assumption about the system state or API.`,
    ``,
    `Before writing any more code:`,
    `1. State the assumption you are currently operating on`,
    `2. Use a read-only tool (Read, Grep, documentation) to verify that assumption`,
    `3. Only proceed with a fix after verification`,
  ].join('\n');
}

function formatDirective(errorCount, errorActions) {
  return [
    `You have now hit ${errorCount} consecutive similar errors despite a previous reflection.`,
    `Your current approach is not working. Stop and change strategy:`,
    ``,
    `- Read the source code or documentation for the API/module you are using`,
    `- Search for working examples of the pattern you are attempting`,
    `- Consider whether the problem is in a different file or layer than you think`,
    ``,
    `Do NOT attempt another variation of the same fix.`,
  ].join('\n');
}

function formatEscalation(errorCount) {
  return [
    `After ${errorCount} consecutive similar errors and multiple strategy changes, this task`,
    `appears to require information or context you don't currently have.`,
    ``,
    `Ask the user for guidance - describe what you've tried and where you're stuck.`,
    `This is not a failure; it's efficient use of the user's time.`,
  ].join('\n');
}
