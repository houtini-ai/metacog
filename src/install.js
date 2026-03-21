#!/usr/bin/env node

/**
 * Metacog PNS - Hook Installer
 *
 * Installs the PostToolUse hook into Claude Code's settings.
 * Can install globally (~/.claude/settings.json) or per-project (.claude/settings.json).
 *
 * Usage:
 *   node install.js                    # Install globally
 *   node install.js --project          # Install for current project
 *   node install.js --project /path    # Install for specific project
 *   node install.js --remove           # Remove the hook
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOOK_SCRIPT_PATH = resolve(join(__dirname, 'hook.js'));
const DIGEST_SCRIPT_PATH = resolve(join(__dirname, 'digest-inject.js'));

function main() {
  const args = process.argv.slice(2);
  const isProject = args.includes('--project');
  const isRemove = args.includes('--remove');

  // Determine settings file location
  let settingsPath;

  if (isProject) {
    const projectIdx = args.indexOf('--project');
    const projectDir = args[projectIdx + 1] && !args[projectIdx + 1].startsWith('--')
      ? resolve(args[projectIdx + 1])
      : process.cwd();
    settingsPath = join(projectDir, '.claude', 'settings.json');
  } else {
    const home = process.env.HOME || process.env.USERPROFILE;
    settingsPath = join(home, '.claude', 'settings.json');
  }

  console.log(`Settings file: ${settingsPath}`);

  // Load existing settings
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    // File doesn't exist yet
  }

  if (isRemove) {
    removeHook(settings, settingsPath);
  } else {
    installHook(settings, settingsPath);
  }
}

function installHook(settings, settingsPath) {
  // Ensure hooks structure exists
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];

  // --- PostToolUse hook (nervous system) ---
  const existingPost = settings.hooks.PostToolUse.find(h =>
    h.hooks?.some(hook => hook.command?.includes('metacog'))
  );

  if (existingPost) {
    console.log('PostToolUse hook already installed. Updating...');
    const hook = existingPost.hooks.find(h => h.command?.includes('metacog'));
    if (hook) hook.command = `node "${HOOK_SCRIPT_PATH}"`;
  } else {
    settings.hooks.PostToolUse.push({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `node "${HOOK_SCRIPT_PATH}"`,
        },
      ],
    });
  }

  // --- UserPromptSubmit hook (digest injector) ---
  const existingDigest = settings.hooks.UserPromptSubmit.find(h =>
    h.hooks?.some(hook => hook.command?.includes('metacog'))
  );

  if (existingDigest) {
    console.log('UserPromptSubmit hook already installed. Updating...');
    const hook = existingDigest.hooks.find(h => h.command?.includes('metacog'));
    if (hook) hook.command = `node "${DIGEST_SCRIPT_PATH}"`;
  } else {
    settings.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: 'command',
          command: `node "${DIGEST_SCRIPT_PATH}"`,
        },
      ],
    });
  }

  // Write settings
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  console.log('');
  console.log('Metacog installed successfully.');
  console.log(`  PostToolUse:       ${HOOK_SCRIPT_PATH}`);
  console.log(`  UserPromptSubmit:  ${DIGEST_SCRIPT_PATH}`);
  console.log('');
  console.log('Two hooks are now active:');
  console.log('  1. Nervous system — fires after every tool call (silent when normal)');
  console.log('  2. Digest injector — fires once per session (injects learned rules)');
  console.log('');
  console.log('To customise thresholds, create .claude/metacog.config.json in your project.');
  console.log('To remove: npx @houtini/metacog --remove');
}

function removeHook(settings, settingsPath) {
  let removed = false;

  for (const hookType of ['PostToolUse', 'UserPromptSubmit']) {
    if (!settings.hooks?.[hookType]) continue;

    const before = settings.hooks[hookType].length;
    settings.hooks[hookType] = settings.hooks[hookType].filter(h =>
      !h.hooks?.some(hook => hook.command?.includes('metacog'))
    );
    if (settings.hooks[hookType].length < before) removed = true;

    if (settings.hooks[hookType].length === 0) {
      delete settings.hooks[hookType];
    }
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (removed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('Metacog hooks removed.');
  } else {
    console.log('No Metacog hooks found. Nothing to remove.');
  }
}

main();
