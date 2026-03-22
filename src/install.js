#!/usr/bin/env node

/**
 * Metacog installer — registers hooks into Claude Code settings.
 *
 * Usage:
 *   npx @houtini/metacog --install            # global install
 *   npx @houtini/metacog --install --project   # project-scoped install
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
metacog — real-time metacognition for Claude Code

Usage:
  npx @houtini/metacog --install              Install hooks globally
  npx @houtini/metacog --install --project    Install hooks into current project
  npx @houtini/metacog --help                 Show this help
`);
    process.exit(0);
  }

  if (!args.includes('--install')) {
    console.log('metacog: use --install to register hooks. Run --help for options.');
    process.exit(0);
  }

  const isProject = args.includes('--project');
  const settingsPath = isProject
    ? join(process.cwd(), '.claude', 'settings.json')
    : join(homedir(), '.claude', 'settings.json');

  const hookRoot = PACKAGE_ROOT;
  const hookJs = join(hookRoot, 'src', 'hook.js');
  const digestJs = join(hookRoot, 'src', 'digest-inject.js');

  // Verify the hook files exist
  try {
    readFileSync(hookJs);
    readFileSync(digestJs);
  } catch {
    console.error('metacog: could not find hook files. Installation may be corrupt.');
    process.exit(1);
  }

  // Read existing settings or start fresh
  let settings = {};
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // No existing settings — start fresh
  }

  if (!settings.hooks) settings.hooks = {};

  // Build hook commands with escaped paths for JSON
  const postToolCmd = `node "${hookJs.replace(/\\/g, '\\\\')}"`;
  const promptCmd = `node "${digestJs.replace(/\\/g, '\\\\')}"`;

  // --- PostToolUse ---
  const postToolHook = {
    matcher: '*',
    hooks: [{ type: 'command', command: postToolCmd }],
  };

  // Remove any existing metacog hooks, then add ours
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    h => !isMetacogHook(h)
  );
  settings.hooks.PostToolUse.push(postToolHook);

  // --- UserPromptSubmit ---
  const promptHook = {
    hooks: [{ type: 'command', command: promptCmd }],
  };

  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    h => !isMetacogHook(h)
  );
  settings.hooks.UserPromptSubmit.push(promptHook);

  // Write settings
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  const scope = isProject ? 'project' : 'global';
  console.log(`metacog: hooks installed (${scope}) -> ${settingsPath}`);
  console.log(`metacog: hook source -> ${hookRoot}`);
  console.log('metacog: ready. Start a new Claude Code session to activate.');
}

/**
 * Check if a hook entry is from metacog (so we can replace it on reinstall)
 */
function isMetacogHook(entry) {
  const hooks = entry.hooks || [];
  return hooks.some(h =>
    typeof h.command === 'string' && (
      h.command.includes('metacog') ||
      h.command.includes('hook.js') ||
      h.command.includes('digest-inject.js')
    )
  );
}

main();
