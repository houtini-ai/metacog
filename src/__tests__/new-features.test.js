import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate as evaluateDrift, buildTaskFingerprint } from '../senses/drift.js';
import { analyzePrompt, recordInteraction } from '../lib/interactions.js';
import { buildRetrospective } from '../lib/retrospective.js';

// --- Helpers ---

function buildState(actions, overrides = {}) {
  return {
    session_id: 'test',
    session_start: new Date(Date.now() - 60000).toISOString(),
    actions,
    baseline: { established: true, avg_token_velocity: 500, turns_sampled: 10 },
    nociception: { escalation_level: 0, cooldown_remaining: 0, last_intervention_at: null },
    turn_count: actions.length,
    last_user_interaction: new Date(Date.now() - 60000).toISOString(),
    ...overrides,
  };
}

function makeAction(overrides = {}) {
  return {
    tool_name: 'Read',
    target_resource: '/src/auth/login.ts',
    action_type: 'read',
    exit_status: 'success',
    error_signature: null,
    token_estimate: 500,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const driftConfig = {
  drift: { min_actions: 4, recent_window: 3, drift_threshold: 0.15, cooldown: 10 },
  o2: { velocity_multiplier: 3, baseline_window: 10 },
  chronos: { time_threshold_minutes: 15, step_threshold: 25 },
  nociception: { consecutive_errors: 3, error_similarity: 0.6, window_size: 5 },
  spatial: { blast_radius_threshold: 5, enabled: true },
  vestibular: { action_similarity: 0.8, consecutive_similar: 4 },
  echo: { write_streak_threshold: 5, cooldown: 8 },
};

// === Task Fingerprint ===

describe('Task Fingerprint - buildTaskFingerprint', () => {
  it('should extract file paths from prompts', () => {
    const fp = buildTaskFingerprint('fix the bug in src/auth/login.ts');
    assert.ok(fp.paths.length > 0, 'Should find file path');
    assert.ok(fp.terms.includes('auth') || fp.terms.includes('login'), 'Should extract path terms');
  });

  it('should extract identifiers', () => {
    const fp = buildTaskFingerprint('the handleUserLogin function is broken');
    assert.ok(fp.terms.some(t => t.includes('handle') || t.includes('login') || t.includes('handleuserlogin')),
      `Should extract camelCase identifier, got: ${fp.terms}`);
  });

  it('should extract quoted references', () => {
    const fp = buildTaskFingerprint('the error says "cannot find module auth"');
    assert.ok(fp.terms.some(t => t.includes('cannot find module auth')),
      `Should extract quoted text, got: ${fp.terms}`);
  });

  it('should handle empty/null input', () => {
    assert.deepEqual(buildTaskFingerprint('').terms, []);
    assert.deepEqual(buildTaskFingerprint(null).terms, []);
    assert.deepEqual(buildTaskFingerprint(undefined).terms, []);
  });

  it('should produce a summary', () => {
    const fp = buildTaskFingerprint('fix the authentication flow in the login component');
    assert.ok(fp.summary.length > 0, 'Should produce a summary');
  });

  it('should cap terms to prevent bloat', () => {
    const longPrompt = 'fix ' + Array.from({length: 50}, (_, i) => `module${i}`).join(' ');
    const fp = buildTaskFingerprint(longPrompt);
    assert.ok(fp.terms.length <= 20, `Should cap terms, got ${fp.terms.length}`);
  });
});

// === Drift Sense ===

describe('Drift - Scope Drift Detection', () => {
  it('should return null without task fingerprint', () => {
    const actions = Array(10).fill(null).map(() => makeAction());
    const state = buildState(actions);
    assert.equal(evaluateDrift(state, makeAction(), driftConfig), null);
  });

  it('should return null when actions match the fingerprint', () => {
    const actions = Array(10).fill(null).map(() =>
      makeAction({ target_resource: '/src/auth/login.ts' })
    );
    const state = buildState(actions, {
      task_fingerprint: { terms: ['auth', 'login'], summary: 'fix auth login', paths: ['src/auth/login.ts'] },
    });
    assert.equal(evaluateDrift(state, makeAction({ target_resource: '/src/auth/session.ts' }), driftConfig), null);
  });

  it('should signal when recent actions diverge from fingerprint', () => {
    // Task is about auth/login, but recent actions are about database/migration
    const earlyActions = [
      makeAction({ target_resource: '/src/auth/login.ts' }),
      makeAction({ target_resource: '/src/auth/session.ts' }),
      makeAction({ target_resource: '/src/auth/middleware.ts' }),
      makeAction({ target_resource: '/src/auth/types.ts' }),
    ];
    const driftedActions = [
      makeAction({ target_resource: '/src/database/connection.ts' }),
      makeAction({ target_resource: '/src/database/migration.ts' }),
      makeAction({ target_resource: '/src/database/schema.ts' }),
    ];
    const state = buildState([...earlyActions, ...driftedActions], {
      task_fingerprint: { terms: ['auth', 'login', 'authentication'], summary: 'fix auth login', paths: [] },
    });
    const signal = evaluateDrift(state, makeAction({ target_resource: '/src/database/pool.ts' }), driftConfig);
    assert.ok(signal, 'Should detect drift from auth to database');
    assert.ok(signal.includes('scope drift') || signal.includes('Intentional'),
      `Should ask about drift: ${signal}`);
  });

  it('should respect cooldown', () => {
    const actions = Array(10).fill(null).map(() =>
      makeAction({ target_resource: '/src/database/migration.ts' })
    );
    const state = buildState(actions, {
      task_fingerprint: { terms: ['auth', 'login'], summary: 'fix auth', paths: [] },
      drift_cooldown: 5,
    });
    assert.equal(evaluateDrift(state, makeAction(), driftConfig), null);
  });

  it('should not fire when too few actions', () => {
    const actions = [makeAction(), makeAction()];
    const state = buildState(actions, {
      task_fingerprint: { terms: ['auth', 'login'], summary: 'fix auth', paths: [] },
    });
    assert.equal(evaluateDrift(state, makeAction(), driftConfig), null);
  });
});

// === Prompt Analysis ===

describe('Interactions - analyzePrompt', () => {
  it('should score high specificity for prompts with file paths', () => {
    const result = analyzePrompt('fix the bug in src/auth/login.ts at line 42');
    assert.ok(result.specificity >= 0.5, `Should be high specificity, got ${result.specificity}`);
    assert.ok(result.hasPath);
    assert.ok(result.hasLineRef);
  });

  it('should score low specificity for vague prompts', () => {
    const result = analyzePrompt('fix the tests');
    assert.ok(result.specificity < 0.3, `Should be low specificity, got ${result.specificity}`);
  });

  it('should detect error text', () => {
    const result = analyzePrompt('I get this error: TypeError: Cannot read properties of undefined when running the auth module');
    assert.ok(result.hasErrorText, 'Should detect error text');
    assert.ok(result.specificity > 0.1, 'Error text should contribute to specificity');
  });

  it('should detect identifiers', () => {
    const result = analyzePrompt('the handleUserLogin function throws on null input');
    assert.ok(result.specificity > 0, 'Identifiers should contribute to specificity');
  });

  it('should handle empty/null', () => {
    assert.equal(analyzePrompt('').specificity, 0);
    assert.equal(analyzePrompt(null).specificity, 0);
  });
});

// === Interaction Recording ===

describe('Interactions - recordInteraction', () => {
  it('should add interaction to state', () => {
    const state = buildState([]);
    const analysis = analyzePrompt('fix src/auth/login.ts');
    const updated = recordInteraction(state, analysis, 'sess-1');
    assert.equal(updated.user_interactions.length, 1);
    assert.ok(updated.user_interactions[0].specificity > 0);
  });

  it('should calculate tools_before_next on previous interaction', () => {
    const state = buildState([], {
      turn_count: 15,
      user_interactions: [
        { specificity: 0.5, turn_at: 3, session_id: 'sess-1', timestamp: new Date().toISOString() },
      ],
    });
    const analysis = analyzePrompt('next task');
    const updated = recordInteraction(state, analysis, 'sess-1');
    assert.equal(updated.user_interactions[0].tools_before_next, 12); // 15 - 3
  });

  it('should maintain rolling window', () => {
    const state = buildState([], {
      user_interactions: Array(25).fill(null).map((_, i) => ({
        specificity: 0.5, turn_at: i, session_id: 'sess-1',
      })),
    });
    const analysis = analyzePrompt('one more');
    const updated = recordInteraction(state, analysis, 'sess-1');
    assert.ok(updated.user_interactions.length <= 20, 'Should trim to window size');
  });

  it('should update last_user_interaction timestamp', () => {
    const state = buildState([], { last_user_interaction: '2026-01-01T00:00:00.000Z' });
    const analysis = analyzePrompt('hello');
    const updated = recordInteraction(state, analysis, 'sess-1');
    assert.notEqual(updated.last_user_interaction, '2026-01-01T00:00:00.000Z');
  });
});

// === Session Retrospective ===

describe('Session Retrospective', () => {
  it('should return empty for very short sessions', () => {
    const state = buildState([makeAction()], { turn_count: 2 });
    assert.equal(buildRetrospective(state, '/tmp'), '');
  });

  it('should return empty for no session', () => {
    assert.equal(buildRetrospective(null, '/tmp'), '');
    assert.equal(buildRetrospective({}, '/tmp'), '');
  });

  it('should produce retrospective for normal session', () => {
    const actions = Array(15).fill(null).map((_, i) =>
      makeAction({
        action_type: i < 8 ? 'read' : 'write',
        timestamp: new Date(Date.now() - (15 - i) * 60000).toISOString(),
      })
    );
    const state = buildState(actions, {
      turn_count: 15,
      session_start: new Date(Date.now() - 20 * 60000).toISOString(),
    });
    const retro = buildRetrospective(state, '/tmp');
    assert.ok(retro.includes('Prior Session Retrospective'), 'Should have header');
    assert.ok(retro.includes('15 tool calls'), 'Should mention tool count');
  });

  it('should mention nociceptive events', () => {
    const actions = Array(10).fill(null).map(() => makeAction());
    const state = buildState(actions, {
      turn_count: 10,
      nociception: { escalation_level: 2, cooldown_remaining: 0, last_intervention_at: 8 },
    });
    const retro = buildRetrospective(state, '/tmp');
    assert.ok(retro.includes('Nociception'), 'Should mention nociception');
    assert.ok(retro.includes('level 2'), 'Should mention escalation level');
  });

  it('should mention signals that fired', () => {
    const actions = Array(10).fill(null).map(() => makeAction());
    const state = buildState(actions, {
      turn_count: 10,
      _o2_fired: true,
      _vestibular_fired: true,
    });
    const retro = buildRetrospective(state, '/tmp');
    assert.ok(retro.includes('O2'), 'Should mention O2');
    assert.ok(retro.includes('Vestibular'), 'Should mention Vestibular');
  });

  it('should summarize user interactions', () => {
    const actions = Array(10).fill(null).map(() => makeAction());
    const state = buildState(actions, {
      turn_count: 30,
      user_interactions: [
        { specificity: 0.8, turn_at: 0, tools_before_next: 10, session_id: 'test' },
        { specificity: 0.3, turn_at: 10, tools_before_next: 20, session_id: 'test' },
      ],
    });
    const retro = buildRetrospective(state, '/tmp');
    assert.ok(retro.includes('user messages'), 'Should mention interaction count');
  });

  it('should summarize delegations', () => {
    const actions = [
      ...Array(8).fill(null).map(() => makeAction()),
      makeAction({ tool_name: 'Agent' }),
      makeAction({ tool_name: 'Agent' }),
    ];
    const state = buildState(actions, { turn_count: 10 });
    const retro = buildRetrospective(state, '/tmp');
    assert.ok(retro.includes('delegation'), 'Should mention delegations');
  });
});
