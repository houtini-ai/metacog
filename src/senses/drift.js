/**
 * Drift - Scope Drift Detection (Priority 3: Focus)
 *
 * Detects when the agent's recent actions have diverged from the
 * original task. The user's prompt is fingerprinted at session start
 * (by digest-inject.js) and stored in state. This sense compares
 * recent action targets against that fingerprint.
 *
 * Common failure mode: user asks to fix test X, agent opens test X,
 * sees it imports module A, opens module A, notices a pattern in A,
 * starts refactoring A — now three dependency hops from the task.
 *
 * The signal is informational: "Your recent actions are about Y,
 * but your task was about X." The agent decides whether the drift
 * is intentional exploration or accidental scope creep.
 */

const DEFAULT_COOLDOWN = 10;

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @returns {string|null} - Signal message or null if normal
 */
export function evaluate(state, action, config) {
  const driftConfig = config.drift || {};

  // Respect cooldown
  if ((state.drift_cooldown || 0) > 0) return null;

  // Need a task fingerprint to compare against
  const fingerprint = state.task_fingerprint;
  if (!fingerprint || !fingerprint.terms || fingerprint.terms.length === 0) return null;

  // Need enough actions to detect drift (not just the first few)
  const minActions = driftConfig.min_actions || 8;
  if (state.actions.length < minActions) return null;

  // Compare recent action targets against the task fingerprint
  const recentWindow = driftConfig.recent_window || 5;
  const recent = state.actions.slice(-recentWindow);
  const recentTargets = recent
    .map(a => a.target_resource)
    .filter(t => t && t !== 'unknown');

  if (recentTargets.length < 3) return null;

  // Extract terms from recent targets
  const recentTerms = extractTermsFromTargets(recentTargets);
  if (recentTerms.size === 0) return null;

  // Calculate overlap between task fingerprint and recent activity
  const taskTerms = new Set(fingerprint.terms);
  const overlap = [...recentTerms].filter(t => taskTerms.has(t));
  const overlapRatio = overlap.length / Math.max(taskTerms.size, 1);

  // Also check the early actions (first N) — if recent actions diverge
  // from both the task AND the early actions, that's stronger signal
  const earlyWindow = Math.min(5, Math.floor(state.actions.length / 2));
  const earlyTargets = state.actions.slice(0, earlyWindow)
    .map(a => a.target_resource)
    .filter(t => t && t !== 'unknown');
  const earlyTerms = extractTermsFromTargets(earlyTargets);
  const earlyOverlap = [...recentTerms].filter(t => earlyTerms.has(t));
  const earlyOverlapRatio = earlyTerms.size > 0
    ? earlyOverlap.length / Math.max(earlyTerms.size, 1)
    : 1; // no early targets = can't compare

  const threshold = driftConfig.drift_threshold || 0.15;

  // Signal when recent actions have low overlap with BOTH the task
  // fingerprint AND the early session actions
  if (overlapRatio <= threshold && earlyOverlapRatio <= threshold) {
    state.drift_cooldown = driftConfig.cooldown || DEFAULT_COOLDOWN;

    // Summarize what the drift looks like
    const recentFocus = summarizeTargets(recentTargets);
    const taskFocus = fingerprint.summary || fingerprint.terms.slice(0, 3).join(', ');

    return `Your task was about "${taskFocus}" but recent actions focus on ${recentFocus}. Intentional exploration, or scope drift?`;
  }

  return null;
}

/**
 * Extract meaningful terms from file paths and command targets.
 * Strips common noise (extensions, common directories).
 */
function extractTermsFromTargets(targets) {
  const terms = new Set();
  const noise = new Set([
    'src', 'lib', 'dist', 'build', 'node_modules', 'test', 'tests',
    '__tests__', 'spec', 'index', 'utils', 'helpers', 'types',
    'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'json', 'md',
    'css', 'scss', 'html', 'vue', 'svelte',
  ]);

  for (const target of targets) {
    const tokens = target
      .split(/[/\\.\s\-_:]+/)
      .map(t => t.toLowerCase())
      .filter(t => t.length > 2 && !noise.has(t) && !/^\d+$/.test(t));
    for (const t of tokens) terms.add(t);
  }

  return terms;
}

/**
 * Produce a short human-readable summary of what recent targets are about.
 */
function summarizeTargets(targets) {
  // Extract unique file/dir names, take the most common
  const names = targets.map(t => {
    const parts = t.split(/[/\\]/);
    // Take the last meaningful part (filename or last dir)
    return parts.filter(p => p && p !== '.').pop() || t;
  });

  const unique = [...new Set(names)];
  if (unique.length <= 2) return unique.join(', ');
  return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} other target${unique.length - 2 > 1 ? 's' : ''}`;
}

/**
 * Build a task fingerprint from the user's prompt text.
 * Called by digest-inject.js on each user message.
 *
 * Extracts:
 *   - File paths mentioned
 *   - Function/class names (camelCase, snake_case, PascalCase)
 *   - Key technical terms
 *   - A short summary string
 *
 * @param {string} promptText - The user's message
 * @returns {object} - { terms: string[], summary: string, paths: string[] }
 */
export function buildTaskFingerprint(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return { terms: [], summary: '', paths: [] };
  }

  const terms = new Set();
  const paths = [];

  // Extract file paths (things that look like paths)
  const pathPattern = /(?:[./\\][\w./\\-]+\.[\w]+|[\w-]+\.(?:js|ts|py|go|rs|jsx|tsx|vue|svelte|css|html|json|yaml|yml|toml|md))/g;
  const pathMatches = promptText.match(pathPattern) || [];
  for (const p of pathMatches) {
    paths.push(p);
    // Add meaningful parts of the path as terms
    const parts = p.split(/[/\\.\-_]+/).filter(t => t.length > 2);
    for (const part of parts) terms.add(part.toLowerCase());
  }

  // Extract identifiers (camelCase, snake_case, PascalCase, SCREAMING_CASE)
  const identPattern = /\b[a-zA-Z][a-zA-Z0-9_]*(?:[A-Z][a-z]+|_[a-z]+)+\b/g;
  const identMatches = promptText.match(identPattern) || [];
  for (const id of identMatches) {
    // Split camelCase/PascalCase into parts
    const parts = id.split(/(?=[A-Z])|_/).map(t => t.toLowerCase()).filter(t => t.length > 2);
    for (const part of parts) terms.add(part);
    terms.add(id.toLowerCase());
  }

  // Extract quoted strings (likely specific references)
  const quotedPattern = /["'`]([^"'`]{3,40})["'`]/g;
  let match;
  while ((match = quotedPattern.exec(promptText)) !== null) {
    const quoted = match[1].trim().toLowerCase();
    if (quoted.length > 2) terms.add(quoted);
  }

  // Extract remaining meaningful words (4+ chars, not common English)
  const commonWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'been', 'will', 'would',
    'could', 'should', 'about', 'there', 'their', 'which', 'when',
    'what', 'your', 'some', 'them', 'then', 'than', 'into', 'also',
    'just', 'like', 'make', 'made', 'need', 'want', 'does', 'done',
    'look', 'please', 'think', 'know', 'here', 'these', 'those',
    'each', 'other', 'after', 'before', 'while', 'where', 'more',
    'only', 'very', 'most', 'even', 'still', 'back', 'over',
    'code', 'file', 'files', 'change', 'changes', 'update',
  ]);

  const words = promptText
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase())
    .filter(w => w.length >= 4 && !commonWords.has(w));

  for (const w of words) terms.add(w);

  // Build a summary from the first 60 chars of the prompt
  const summary = promptText.slice(0, 80).replace(/\n/g, ' ').trim();

  return {
    terms: [...terms].slice(0, 20), // cap to prevent bloat
    summary,
    paths,
  };
}
