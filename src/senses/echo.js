/**
 * Echo - Validation Bias (Priority 3: Groundedness)
 *
 * Detects when the agent is confirming its own work rather than seeking
 * independent validation — the "echo chamber" problem.
 *
 * Research shows a 64.5% self-correction blind spot: the same bias that
 * caused a bug also causes the agent to judge its fix as correct.
 * The antidote is external grounding — running the project's real tests,
 * not just eyeballing the diff or writing a bespoke validation.
 *
 * Two detection modes:
 *   1. Write streak: N consecutive writes/edits with no test execution
 *   2. Self-test: writes a test file then runs only that test, skipping
 *      the project's broader test suite
 */

const DEFAULT_COOLDOWN = 8;

// Patterns that indicate a Bash command is running tests
const TEST_COMMAND_PATTERNS = [
  /\bnpm\s+test\b/,
  /\bnpm\s+run\s+test\b/,
  /\byarn\s+test\b/,
  /\bpnpm\s+test\b/,
  /\bpytest\b/,
  /\bjest\b/,
  /\bvitest\b/,
  /\bmocha\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bmake\s+test\b/,
  /\bnode\s+--test\b/,
  /\brspec\b/,
  /\bdotnet\s+test\b/,
  /\bmvn\s+test\b/,
  /\bgradle\s+test\b/,
];

// Patterns that indicate a file is a test file
const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /_test\./,
  /test_/,
  /__tests__/,
  /tests?\//,
  /spec\//,
];

/**
 * @param {object} state - Current session state
 * @param {object} action - The action that just occurred
 * @param {object} config - Proprioception config
 * @returns {string|null} - Signal message or null if normal
 */
export function evaluate(state, action, config) {
  const { echo } = config;

  // Respect cooldown
  if ((state.echo_cooldown || 0) > 0) return null;

  const actions = state.actions;
  if (actions.length < 3) return null;

  // --- Detection 1: Write streak without test execution ---
  const writeStreak = countTrailingWrites(actions);

  if (writeStreak >= echo.write_streak_threshold) {
    state.echo_cooldown = echo.cooldown || DEFAULT_COOLDOWN;
    return `${writeStreak} consecutive edits without running tests. Have you validated these changes against the project's existing test suite?`;
  }

  // --- Detection 2: Self-test pattern ---
  // Write source → Write test → Run only that test (not the full suite)
  if (action.action_type === 'execute' && action.exit_status === 'success') {
    const cmd = action.target_resource || '';
    const isTestRun = TEST_COMMAND_PATTERNS.some(p => p.test(cmd));

    if (isTestRun && isSingleTestRun(cmd)) {
      // Look back: was there a source write followed by a test file write?
      const recentWrites = actions.slice(-6).filter(a => a.action_type === 'write');
      const hasSourceWrite = recentWrites.some(a => !isTestFile(a.target_resource));
      const hasTestWrite = recentWrites.some(a => isTestFile(a.target_resource));

      if (hasSourceWrite && hasTestWrite) {
        state.echo_cooldown = echo.cooldown || DEFAULT_COOLDOWN;
        return `You wrote source code, wrote a test, and ran only that test. The project's full test suite would catch regressions your new test can't.`;
      }
    }
  }

  return null;
}

/**
 * Count consecutive write/edit actions at the end of the action window.
 * Reads and other non-write, non-test actions break the streak.
 */
function countTrailingWrites(actions) {
  let count = 0;
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (a.action_type === 'write') {
      count++;
    } else if (a.action_type === 'execute' && isTestExecution(a.target_resource)) {
      // A test run breaks the write streak
      break;
    } else if (a.action_type === 'read') {
      // Reads don't break the streak — reading between writes is normal
      continue;
    } else {
      // Other execute actions (non-test) don't break streak
      continue;
    }
  }
  return count;
}

/**
 * Check if a command runs tests
 */
function isTestExecution(cmd) {
  if (!cmd) return false;
  return TEST_COMMAND_PATTERNS.some(p => p.test(cmd));
}

/**
 * Check if a test command targets a single file rather than the full suite.
 * e.g. `jest src/foo.test.js` vs `jest` or `npm test`
 */
function isSingleTestRun(cmd) {
  if (!cmd) return false;

  // "npm test" / "yarn test" / "make test" without args = full suite
  if (/^(npm|yarn|pnpm)\s+(run\s+)?test\s*$/.test(cmd.trim())) return false;
  if (/^make\s+test\s*$/.test(cmd.trim())) return false;

  // If the command contains a test file path, it's likely a single-test run
  return TEST_FILE_PATTERNS.some(p => p.test(cmd));
}

/**
 * Check if a file path looks like a test file
 */
function isTestFile(filePath) {
  if (!filePath) return false;
  return TEST_FILE_PATTERNS.some(p => p.test(filePath));
}
