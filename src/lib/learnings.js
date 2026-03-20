/**
 * Cross-session learning system for Metacog
 *
 * Manages behavioral learnings that persist across sessions.
 * Supports both global learnings (~/.claude/) and per-project
 * learnings (<project>/.claude/).
 *
 * Storage (per scope):
 *   metacog-learnings.jsonl  — append-only raw learnings
 *   metacog-digest.md        — compiled readable digest
 *
 * Decay model:
 *   Rules that successfully suppress their target failure are
 *   reinforced (absence of failure + rule active = evidence).
 *   Rules only decay when they haven't been active at all.
 *
 * Zero dependencies. Pure Node.js.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');
const LEARNINGS_PATH = join(CLAUDE_DIR, 'metacog-learnings.jsonl');
const DIGEST_PATH = join(CLAUDE_DIR, 'metacog-digest.md');

// Decay: only applies to rules that haven't been active (injected)
// Rules that are active but whose failure doesn't appear get reinforced instead
const INACTIVE_DECAY_HALF_LIFE_DAYS = 60;  // slower decay — only for truly dormant rules
const PRUNE_THRESHOLD_DAYS = 120;           // longer before pruning
const MAX_DIGEST_ENTRIES = 25;

/**
 * Known behavioral patterns and how to detect them from session state.
 * Each detector receives the full session state and returns a learning or null.
 */
const PATTERN_DETECTORS = [
  {
    id: 'circular_search',
    // Used by JIT routing: which tool types make this rule relevant
    relevantTools: ['Read', 'Grep', 'Glob'],
    detect(state) {
      const actions = state.actions || [];
      const searchRuns = countConsecutiveRuns(actions, 'read');
      if (searchRuns >= 2) {
        return {
          pattern: 'circular_search',
          category: 'Search Patterns',
          lesson: 'When searching for a pattern, use one broad Grep before narrowing. Multiple sequential search calls on the same target signals thrashing.',
        };
      }
      return null;
    },
  },
  {
    id: 'repeated_file_read',
    relevantTools: ['Read'],
    detect(state) {
      const actions = state.actions || [];
      const readTargets = actions
        .filter(a => a.tool_name === 'Read')
        .map(a => a.target_resource);

      const counts = {};
      for (const t of readTargets) {
        counts[t] = (counts[t] || 0) + 1;
      }

      const repeats = Object.entries(counts).filter(([, c]) => c >= 3);
      if (repeats.length > 0) {
        return {
          pattern: 'repeated_file_read',
          category: 'File Access',
          lesson: 'Files read 3+ times per session should be summarised to a scratchpad early. Context compaction deletes the content but not the need for it.',
        };
      }
      return null;
    },
  },
  {
    id: 'error_loop',
    relevantTools: ['Bash', 'Edit', 'Write'],
    detect(state) {
      const actions = state.actions || [];
      const recentErrors = actions.slice(-10).filter(a => a.exit_status === 'error');
      if (recentErrors.length >= 4) {
        const sigs = recentErrors.map(a => a.error_signature).filter(Boolean);
        const uniqueSigs = new Set(sigs);
        if (uniqueSigs.size <= 2 && sigs.length >= 3) {
          return {
            pattern: 'error_loop',
            category: 'Error Handling',
            lesson: 'When hitting the same error 3+ times, stop and diagnose the root cause rather than retrying. Check assumptions about paths, APIs, and environment.',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'long_autonomous_run',
    relevantTools: [],  // always relevant — meta-pattern
    detect(state) {
      if (state.turn_count > 50) {
        return {
          pattern: 'long_autonomous_run',
          category: 'Autonomy',
          lesson: 'Sessions exceeding 50 tool calls should delegate independent work to background agents earlier. Context pressure increases with every call.',
        };
      }
      return null;
    },
  },
  {
    id: 'write_heavy_session',
    relevantTools: ['Edit', 'Write'],
    detect(state) {
      const actions = state.actions || [];
      const writes = actions.filter(a => a.action_type === 'write').length;
      const reads = actions.filter(a => a.action_type === 'read').length;
      if (writes > 10 && reads < writes * 0.5) {
        return {
          pattern: 'write_heavy_session',
          category: 'Code Quality',
          lesson: 'High write-to-read ratio suggests editing without sufficient context. Read before writing — especially files you haven\'t seen this session.',
        };
      }
      return null;
    },
  },
];

/**
 * Analyse a completed session and extract behavioral learnings.
 *
 * Two types of output:
 *   - 'detection': the failure pattern fired (evidence of the problem)
 *   - 'suppression': the pattern DIDN'T fire, but was previously known
 *     and the digest was active this session (evidence the rule works)
 *
 * Returns array of learning objects.
 */
export function extractLearnings(state, activePatternIds = []) {
  const learnings = [];
  const activeSet = new Set(activePatternIds);

  for (const detector of PATTERN_DETECTORS) {
    try {
      const result = detector.detect(state);
      if (result) {
        // Pattern fired — this is a detection (the problem happened)
        learnings.push({
          ...result,
          type: 'detection',
          detected_at: new Date().toISOString(),
          session_turn_count: state.turn_count || 0,
        });
      } else if (activeSet.has(detector.id)) {
        // Pattern did NOT fire, but the rule was injected this session.
        // The rule successfully suppressed the failure — reinforce it.
        learnings.push({
          pattern: detector.id,
          type: 'suppression',
          detected_at: new Date().toISOString(),
          session_turn_count: state.turn_count || 0,
        });
      }
    } catch {
      // Detector failure is non-fatal
    }
  }

  return learnings;
}

/**
 * Append learnings to the JSONL file.
 * Writes to both global and project-scoped logs if scope provided.
 */
export function persistLearnings(learnings, scope) {
  if (!learnings.length) return;

  // Always write to global
  mkdirSync(CLAUDE_DIR, { recursive: true });
  const lines = learnings.map(l => JSON.stringify(l)).join('\n') + '\n';
  appendFileSync(LEARNINGS_PATH, lines, 'utf-8');

  // Also write to project scope if provided
  if (scope) {
    try {
      mkdirSync(scope, { recursive: true });
      const projectPath = join(scope, 'metacog-learnings.jsonl');
      appendFileSync(projectPath, lines, 'utf-8');
    } catch {
      // Project-scoped write failure is non-fatal
    }
  }
}

/**
 * Read all learnings from a JSONL file.
 */
export function readLearningsLog(path) {
  const filePath = path || LEARNINGS_PATH;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Compile JSONL into a deduplicated, decayed, ranked digest.
 *
 * Decay model (inverted from naive time-decay):
 *   - Detections increase evidence (the failure happened)
 *   - Suppressions increase evidence (the rule prevented the failure)
 *   - Only rules with no recent activity at all decay
 *   - A rule that fires AND gets suppressed is healthy — it's working
 *
 * Returns the compiled entries.
 */
export function compileLearnings(scope) {
  const learningsPath = scope ? join(scope, 'metacog-learnings.jsonl') : LEARNINGS_PATH;
  const raw = readLearningsLog(learningsPath);
  if (!raw.length) return [];

  const now = Date.now();

  // Group by pattern ID, merge evidence
  const byPattern = {};
  for (const entry of raw) {
    const id = entry.pattern;
    if (!byPattern[id]) {
      byPattern[id] = {
        pattern: id,
        category: entry.category || 'General',
        lesson: entry.lesson,
        detections: 0,
        suppressions: 0,
        first_seen: entry.detected_at,
        last_active: entry.detected_at,  // last time this rule was relevant at all
        confidence: 0.5,
      };
    }

    // Track both types of evidence separately
    if (entry.type === 'suppression') {
      byPattern[id].suppressions++;
    } else {
      byPattern[id].detections++;
    }

    // Update timing — any activity (detection or suppression) counts
    if (entry.detected_at > byPattern[id].last_active) {
      byPattern[id].last_active = entry.detected_at;
      // Only update lesson from detections (suppressions don't carry lessons)
      if (entry.lesson) {
        byPattern[id].lesson = entry.lesson;
      }
    }
  }

  // Apply confidence model
  const entries = Object.values(byPattern).map(entry => {
    const daysSinceActive = (now - new Date(entry.last_active).getTime()) / (1000 * 60 * 60 * 24);
    const totalEvidence = entry.detections + entry.suppressions;

    // Base confidence from total evidence (detections + suppressions both count)
    let confidence = Math.min(0.95, 0.4 + (totalEvidence * 0.08));

    // Suppression bonus: if the rule is working, boost confidence slightly
    // A rule with 5 detections and 10 suppressions is proven effective
    if (entry.suppressions > 0 && entry.detections > 0) {
      const effectivenessRatio = entry.suppressions / (entry.detections + entry.suppressions);
      confidence = Math.min(0.95, confidence + (effectivenessRatio * 0.1));
    }

    // Decay only applies to INACTIVE rules — rules with no recent activity
    // A rule that keeps getting suppressed is active and should not decay
    if (daysSinceActive > INACTIVE_DECAY_HALF_LIFE_DAYS) {
      const halfLives = (daysSinceActive - INACTIVE_DECAY_HALF_LIFE_DAYS) / INACTIVE_DECAY_HALF_LIFE_DAYS;
      confidence *= Math.pow(0.5, halfLives);
    }

    return {
      ...entry,
      evidence: totalEvidence,
      confidence: Math.round(confidence * 100) / 100,
      days_since_active: Math.round(daysSinceActive),
      prunable: daysSinceActive > PRUNE_THRESHOLD_DAYS && totalEvidence < 3,
    };
  });

  // Remove prunable entries
  const active = entries.filter(e => !e.prunable);

  // Sort by confidence * evidence (weighted relevance)
  active.sort((a, b) => (b.confidence * b.evidence) - (a.confidence * a.evidence));

  return active.slice(0, MAX_DIGEST_ENTRIES);
}

/**
 * Generate the markdown digest from compiled learnings.
 * Includes suppression/detection stats so the agent can see rule effectiveness.
 */
export function generateDigest(entries) {
  if (!entries.length) {
    return '# Agent Behavioral Learnings\n\nNo learnings recorded yet.\n';
  }

  const now = new Date().toISOString().split('T')[0];
  const totalEvidence = entries.reduce((sum, e) => sum + e.evidence, 0);

  const lines = [
    '# Agent Behavioral Learnings',
    `Last compiled: ${now} | ${entries.length} patterns from ${totalEvidence} observations`,
    '',
  ];

  // Group by category
  const byCategory = {};
  for (const entry of entries) {
    const cat = entry.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(entry);
  }

  for (const [category, items] of Object.entries(byCategory)) {
    lines.push(`## ${category}`);
    for (const item of items) {
      const conf = Math.round(item.confidence * 100);
      const stats = item.suppressions > 0
        ? `${item.detections} detections, ${item.suppressions} suppressions`
        : `seen ${item.evidence}x`;
      lines.push(`- ${item.lesson} (confidence: ${conf}%, ${stats})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Full compile-and-write pipeline.
 * Merges global + project-scoped learnings when scope provided.
 */
export function compileAndWriteDigest(scope) {
  // Compile global learnings
  const globalEntries = compileLearnings();

  // If scope provided, also compile project-specific learnings and merge
  let entries = globalEntries;
  if (scope) {
    const projectEntries = compileLearnings(scope);
    entries = mergeEntries(globalEntries, projectEntries);
  }

  const markdown = generateDigest(entries);

  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(DIGEST_PATH, markdown, 'utf-8');

  // Also return the active pattern IDs for suppression tracking
  const activePatternIds = entries.map(e => e.pattern);

  return { entries: entries.length, path: DIGEST_PATH, activePatternIds };
}

/**
 * Merge global and project-scoped entries, preferring project-specific data.
 */
function mergeEntries(global, project) {
  const byPattern = {};

  for (const entry of global) {
    byPattern[entry.pattern] = entry;
  }

  // Project entries override global (more specific context)
  for (const entry of project) {
    if (byPattern[entry.pattern]) {
      // Merge: take the higher confidence, sum evidence
      const existing = byPattern[entry.pattern];
      byPattern[entry.pattern] = {
        ...existing,
        confidence: Math.max(existing.confidence, entry.confidence),
        evidence: existing.evidence + entry.evidence,
        detections: (existing.detections || 0) + (entry.detections || 0),
        suppressions: (existing.suppressions || 0) + (entry.suppressions || 0),
      };
    } else {
      byPattern[entry.pattern] = entry;
    }
  }

  const merged = Object.values(byPattern);
  merged.sort((a, b) => (b.confidence * b.evidence) - (a.confidence * a.evidence));
  return merged.slice(0, MAX_DIGEST_ENTRIES);
}

// --- Helpers ---

function countConsecutiveRuns(actions, actionType) {
  let maxRun = 0;
  let currentRun = 0;
  for (const a of actions) {
    if (a.action_type === actionType) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

export { LEARNINGS_PATH, DIGEST_PATH, CLAUDE_DIR, PATTERN_DETECTORS };
