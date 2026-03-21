#!/usr/bin/env node

/**
 * Metacog Digest Injector — UserPromptSubmit hook
 *
 * Fires on every user message. On first message of a session:
 *   1. Compiles latest learnings (global + project-scoped)
 *   2. Stores active pattern IDs for reinforcement tracking
 *   3. Injects digest as system-reminder via stderr
 *
 * On subsequent messages: exits silently (exit 0).
 *
 * Output:
 *   exit 0, no stdout = no output (subsequent messages, or no learnings)
 *   exit 0, stdout JSON = digest injected via systemMessage
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { compileAndWriteDigest, DIGEST_PATH, CLAUDE_DIR } from './lib/learnings.js';

const SESSION_MARKER_PATH = join(CLAUDE_DIR, '.metacog-session-marker');
const ACTIVE_PATTERNS_PATH = join(CLAUDE_DIR, '.metacog-active-patterns.json');

async function main() {
  try {
    // Read hook input
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    const sessionId = hookInput.session_id || 'unknown';
    const cwd = hookInput.cwd || process.cwd();

    mkdirSync(CLAUDE_DIR, { recursive: true });

    // Check if this is the first message of this session
    let lastSessionId = null;
    try {
      lastSessionId = readFileSync(SESSION_MARKER_PATH, 'utf-8').trim();
    } catch {
      // No marker = first session ever
    }

    if (lastSessionId === sessionId) {
      // Already injected for this session — exit silently
      process.exit(0);
    }

    // Mark this session
    writeFileSync(SESSION_MARKER_PATH, sessionId, 'utf-8');

    // Derive project scope from cwd
    const projectScope = join(cwd, '.claude');

    // Compile fresh digest (merges global + project-scoped learnings)
    const result = compileAndWriteDigest(projectScope);

    if (result.entries === 0) {
      // No learnings yet — exit silently
      process.exit(0);
    }

    // Persist active pattern IDs for reinforcement tracking at session end.
    // When the session ends and state.js extracts learnings, it reads this
    // file to know which patterns were injected — so it can emit suppression
    // records for patterns that DIDN'T fire (proving the rule worked).
    try {
      writeFileSync(
        ACTIVE_PATTERNS_PATH,
        JSON.stringify({ sessionId, patterns: result.activePatternIds }),
        'utf-8'
      );
    } catch {
      // Non-fatal — reinforcement tracking degrades but detection still works
    }

    // Read the compiled digest
    const digest = readFileSync(DIGEST_PATH, 'utf-8');

    // Inject as system message via stdout JSON
    const output = JSON.stringify({
      continue: true,
      suppressOutput: false,
      systemMessage: `[Metacog Behavioral Digest]\n${digest}`
    });
    process.stdout.write(output);
    process.exit(0);

  } catch (err) {
    // Graceful degradation — never break the agent
    process.exit(0);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    setTimeout(() => resolve(data), 2000);
  });
}

main();
