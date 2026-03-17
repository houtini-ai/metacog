/**
 * Configuration for Metacog PNS
 *
 * Sensible defaults that work out of the box.
 * User can override via metacog.config.json in project root.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DEFAULTS = {
  proprioception: {
    o2: {
      velocity_multiplier: 3,      // trigger when token velocity > baseline * N
      baseline_window: 10,         // turns to establish baseline
    },
    chronos: {
      time_threshold_minutes: 15,  // trigger after N minutes without user interaction
      step_threshold: 25,          // trigger after N tool calls without user interaction
    },
    nociception: {
      consecutive_errors: 3,       // consecutive similar errors before signal
      error_similarity: 0.6,       // threshold for "same error" (0-1)
      window_size: 5,              // sliding window for error rate calc
    },
    spatial: {
      blast_radius_threshold: 5,   // file imports before signaling
      enabled: true,               // can be disabled for performance on huge repos
    },
    vestibular: {
      action_similarity: 0.8,      // threshold for "same action"
      consecutive_similar: 4,      // consecutive similar actions before signal
    },
  },
  nociception: {
    escalation_cooldown: 5,        // turns of silence after intervention
    reflex_arc_threshold: 8,       // consecutive failures before hard escalation
  },
};

/**
 * Load config with user overrides merged on top of defaults
 */
export function loadConfig(projectDir) {
  const config = structuredClone(DEFAULTS);

  if (!projectDir) return config;

  // Try loading user config
  const configPaths = [
    join(projectDir, '.claude', 'metacog.config.json'),
    join(projectDir, 'metacog.config.json'),
  ];

  for (const configPath of configPaths) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(raw);
      deepMerge(config, userConfig);
      break;
    } catch {
      // No user config at this path, try next
    }
  }

  return config;
}

/**
 * Deep merge source into target (mutates target)
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
      && target[key] && typeof target[key] === 'object'
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

export { DEFAULTS };
