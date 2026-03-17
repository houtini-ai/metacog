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

  // Check if already installed
  const existing = settings.hooks.PostToolUse.find(h =>
    h.hooks?.some(hook => hook.command?.includes('metacog'))
  );

  if (existing) {
    console.log('Metacog hook is already installed. Updating...');
    // Update the command path
    const hook = existing.hooks.find(h => h.command?.includes('metacog'));
    if (hook) hook.command = `node "${HOOK_SCRIPT_PATH}"`;
  } else {
    // Add new hook entry
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

  // Write settings
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  console.log('');
  console.log('Metacog PNS installed successfully.');
  console.log(`Hook script: ${HOOK_SCRIPT_PATH}`);
  console.log('');
  console.log('The hook will fire after every tool call. When your senses detect');
  console.log('something abnormal, you will receive a [Proprioception] signal.');
  console.log('When everything is fine, there is zero overhead - silence means health.');
  console.log('');
  console.log('To customise thresholds, create .claude/metacog.config.json in your project.');
  console.log('To remove: node install.js --remove');
}

function removeHook(settings, settingsPath) {
  if (!settings.hooks?.PostToolUse) {
    console.log('No Metacog hook found. Nothing to remove.');
    return;
  }

  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
    !h.hooks?.some(hook => hook.command?.includes('metacog'))
  );

  // Clean up empty arrays
  if (settings.hooks.PostToolUse.length === 0) {
    delete settings.hooks.PostToolUse;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  console.log('Metacog PNS hook removed.');
}

main();
