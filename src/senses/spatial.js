/**
 * Spatial - Blast Radius Awareness (Priority 4: Peripheral Vision)
 *
 * The agent is inherently myopic - it only "sees" the file it's editing.
 * This sense provides peripheral vision by checking how many other files
 * depend on the file that was just modified.
 *
 * Non-judgmental: just states the fact. The agent's reasoning handles the rest.
 *
 * Performance: caches git grep results in session state to avoid repeated
 * shell-outs. Cache entries expire after CACHE_TTL_MS. Non-git repos are
 * detected once and skipped thereafter.
 */

import { execSync } from 'child_process';
import { basename, extname } from 'path';

// File extensions where import/dependency tracking is meaningful
const TRACKABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.cs',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.less',
]);

const CACHE_TTL_MS = 30_000;  // 30 seconds
const MAX_CACHE_ENTRIES = 50;

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

  // Initialise cache in state if missing
  if (!state._spatial_cache) {
    state._spatial_cache = { results: {}, is_git_repo: null };
  }
  const cache = state._spatial_cache;

  // Detect non-git repo once — skip all future checks
  if (cache.is_git_repo === false) return null;
  if (cache.is_git_repo === null) {
    cache.is_git_repo = checkIsGitRepo(cwd);
    if (!cache.is_git_repo) return null;
  }

  const fileName = basename(filePath, ext);

  // Check cache first
  const now = Date.now();
  const cached = cache.results[fileName];
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    if (cached.count >= spatial.blast_radius_threshold) {
      return `You modified ${basename(filePath)}. ${cached.count} other file${cached.count === 1 ? '' : 's'} reference this module.`;
    }
    return null;
  }

  try {
    let result;
    try {
      result = execSync(
        `git grep -l --fixed-strings "${fileName}" -- "*.js" "*.ts" "*.jsx" "*.tsx" "*.py" "*.go" "*.rs" "*.vue" "*.svelte"`,
        { cwd, timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch {
      // git grep failed (no matches, or error) - cache as 0
      cache.results[fileName] = { count: 0, ts: now };
      evictOldEntries(cache);
      return null;
    }

    if (!result) {
      cache.results[fileName] = { count: 0, ts: now };
      return null;
    }

    // Count matching files, excluding the file itself
    const matches = result
      .split('\n')
      .filter(line => line.trim() && !line.includes(basename(filePath)))
      .length;

    // Store in cache
    cache.results[fileName] = { count: matches, ts: now };
    evictOldEntries(cache);

    if (matches >= spatial.blast_radius_threshold) {
      return `You modified ${basename(filePath)}. ${matches} other file${matches === 1 ? '' : 's'} reference this module.`;
    }
  } catch {
    // Any error in blast radius detection is non-fatal
    return null;
  }

  return null;
}

/**
 * Check if cwd is inside a git repo.
 */
function checkIsGitRepo(cwd) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd, timeout: 1000, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Evict oldest cache entries if over limit.
 */
function evictOldEntries(cache) {
  const keys = Object.keys(cache.results);
  if (keys.length <= MAX_CACHE_ENTRIES) return;

  // Sort by timestamp ascending, remove oldest
  const sorted = keys.sort((a, b) => cache.results[a].ts - cache.results[b].ts);
  const toRemove = sorted.slice(0, keys.length - MAX_CACHE_ENTRIES);
  for (const key of toRemove) {
    delete cache.results[key];
  }
}
