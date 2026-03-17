/**
 * Spatial - Blast Radius Awareness (Priority 4: Peripheral Vision)
 *
 * The agent is inherently myopic - it only "sees" the file it's editing.
 * This sense provides peripheral vision by checking how many other files
 * depend on the file that was just modified.
 *
 * Non-judgmental: just states the fact. The agent's reasoning handles the rest.
 */

import { execSync } from 'child_process';
import { basename, dirname, extname } from 'path';

// File extensions where import/dependency tracking is meaningful
const TRACKABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.cs',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.less',
]);

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @param {string} cwd - Current working directory
 * @returns {string|null} - Signal message or null if normal
 */
export function evaluate(state, action, config, cwd) {
  const { spatial } = config;

  if (!spatial.enabled) return null;

  // Only check on write actions
  if (action.action_type !== 'write') return null;

  const filePath = action.target_resource;
  if (!filePath || filePath === 'unknown') return null;

  const ext = extname(filePath).toLowerCase();
  if (!TRACKABLE_EXTENSIONS.has(ext)) return null;

  const fileName = basename(filePath, ext);

  try {
    // Fast grep for imports/requires of this file
    // We search for the filename (without extension) in import-like patterns
    // Timeout after 3 seconds to avoid blocking on huge repos
    const patterns = [
      fileName,  // catches: import X from './fileName', require('./fileName'), etc.
    ];

    const grepPattern = patterns.join('|');

    // Use git grep if in a repo (much faster, respects .gitignore), fall back to grep -r
    let result;
    try {
      result = execSync(
        `git grep -l --fixed-strings "${fileName}" -- "*.js" "*.ts" "*.jsx" "*.tsx" "*.py" "*.go" "*.rs" "*.vue" "*.svelte"`,
        { cwd, timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch {
      // git grep failed (not a repo, or no matches) - that's fine
      return null;
    }

    if (!result) return null;

    // Count matching files, excluding the file itself
    const matches = result
      .split('\n')
      .filter(line => line.trim() && !line.includes(basename(filePath)))
      .length;

    if (matches >= spatial.blast_radius_threshold) {
      return `You modified ${basename(filePath)}. ${matches} other file${matches === 1 ? '' : 's'} reference this module.`;
    }
  } catch {
    // Any error in blast radius detection is non-fatal
    // Graceful degradation: we just lose this sense for this turn
    return null;
  }

  return null;
}
