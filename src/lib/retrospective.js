/**
 * Session Retrospective for Metacog
 *
 * Generates a brief, actionable retrospective of the prior session.
 * Injected at the start of the next session alongside the behavioral digest.
 *
 * The retrospective answers: "What happened last session that's worth knowing?"
 *
 * Categories of insight:
 *   - Signals that fired (what went wrong or was unusual)
 *   - Efficiency metrics (tool calls per user message, delegation patterns)
 *   - User collaboration patterns (prompt specificity, check-in frequency)
 *   - Motor learnings extracted (what was learned from resolved failures)
 *
 * Design: brief and skimmable. The agent should be able to absorb this
 * in ~100 tokens and move on. Not a report — a glanceable status.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Build a retrospective from the prior session's state.
 *
 * @param {object} state - The state object (may be from prior session)
 * @param {string} projectScope - Path to project .claude dir
 * @returns {string} - Formatted retrospective or empty string
 */
export function buildRetrospective(state, projectScope) {
  if (!state || !state.session_id) return '';
  if ((state.turn_count || 0) < 5) return ''; // too short to analyze

  const lines = ['[Metacog — Prior Session Retrospective]'];
  const insights = [];

  // --- Session overview ---
  const duration = formatSessionDuration(state);
  insights.push(`Last session: ${state.turn_count} tool calls${duration ? ` over ${duration}` : ''}.`);

  // --- Signals that fired ---
  const signalSummary = summarizeSignals(state);
  if (signalSummary) {
    insights.push(signalSummary);
  }

  // --- Nociceptive events ---
  if (state.nociception?.escalation_level > 0) {
    const level = state.nociception.escalation_level;
    const labels = ['', 'Socratic prompt', 'Directive intervention', 'User escalation'];
    insights.push(
      `Nociception reached level ${level} (${labels[level] || 'unknown'}). ` +
      (level >= 2
        ? 'The agent was stuck — consider whether the task needs restructuring.'
        : 'Error friction was elevated but resolved.')
    );
  }

  // --- Delegation patterns ---
  const delegations = (state.actions || []).filter(a => a.tool_name === 'Agent').length;
  if (delegations > 0) {
    insights.push(`${delegations} subagent delegation${delegations > 1 ? 's' : ''} used.`);
  }

  // --- User interaction patterns ---
  const interactionInsight = summarizeInteractions(state);
  if (interactionInsight) {
    insights.push(interactionInsight);
  }

  // --- Action distribution ---
  const distribution = summarizeActions(state);
  if (distribution) {
    insights.push(distribution);
  }

  if (insights.length <= 1) return ''; // nothing interesting

  for (const insight of insights) {
    lines.push(insight);
  }

  return lines.join('\n');
}

/**
 * Summarize which senses fired based on cooldown evidence in state.
 */
function summarizeSignals(state) {
  const fired = [];

  if ((state.o2_cooldown || 0) > 0 || state._o2_fired) {
    fired.push('O2 (context velocity)');
  }
  if ((state._chronos_last_level || 0) > 0) {
    fired.push(`Chronos (level ${state._chronos_last_level})`);
  }
  if ((state.vestibular_cooldown || 0) > 0 || state._vestibular_fired) {
    fired.push('Vestibular (action repetition)');
  }
  if ((state.echo_cooldown || 0) > 0 || state._echo_fired) {
    fired.push('Echo (validation bias)');
  }
  if ((state.drift_cooldown || 0) > 0 || state._drift_fired) {
    fired.push('Drift (scope drift)');
  }

  if (fired.length === 0) return null;
  return `Senses that fired: ${fired.join(', ')}.`;
}

/**
 * Summarize user interaction patterns from the session.
 */
function summarizeInteractions(state) {
  const interactions = state.user_interactions || [];
  if (interactions.length < 2) return null;

  const toolCounts = interactions
    .filter(i => i.tools_before_next != null)
    .map(i => i.tools_before_next);

  if (toolCounts.length === 0) return null;

  const avgTools = Math.round(toolCounts.reduce((a, b) => a + b, 0) / toolCounts.length);
  const maxTools = Math.max(...toolCounts);

  const avgSpecificity = interactions.reduce((s, i) => s + (i.specificity || 0), 0) / interactions.length;

  const parts = [];
  parts.push(`${interactions.length} user messages, avg ${avgTools} tool calls between messages`);

  if (maxTools > 30) {
    parts.push(`(longest autonomous run: ${maxTools} calls)`);
  }

  if (avgSpecificity < 0.2) {
    parts.push('— prompts were mostly broad/exploratory');
  } else if (avgSpecificity > 0.6) {
    parts.push('— prompts were specific and targeted');
  }

  return parts.join(' ');
}

/**
 * Summarize the action distribution (read/write/execute ratio).
 */
function summarizeActions(state) {
  const actions = state.actions || [];
  if (actions.length < 5) return null;

  const reads = actions.filter(a => a.action_type === 'read').length;
  const writes = actions.filter(a => a.action_type === 'write').length;
  const executes = actions.filter(a => a.action_type === 'execute').length;
  const errors = actions.filter(a => a.exit_status === 'error').length;

  const parts = [];
  parts.push(`Action mix: ${reads} reads, ${writes} writes, ${executes} executes`);

  if (errors > 0) {
    const errorRate = Math.round((errors / actions.length) * 100);
    parts.push(`(${errors} errors, ${errorRate}% error rate)`);
  }

  // Flag imbalances
  if (writes > reads * 2 && writes > 5) {
    parts.push('— heavy on writes relative to reads');
  }

  return parts.join(' ');
}

/**
 * Format session duration from state timestamps.
 */
function formatSessionDuration(state) {
  if (!state.session_start) return null;

  const actions = state.actions || [];
  if (actions.length === 0) return null;

  const start = new Date(state.session_start).getTime();
  const lastAction = actions[actions.length - 1];
  const end = new Date(lastAction.timestamp).getTime();

  if (isNaN(start) || isNaN(end)) return null;

  const ms = end - start;
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
