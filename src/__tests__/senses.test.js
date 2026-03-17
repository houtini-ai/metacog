import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readState, createAction, appendAction, estimateTokens } from '../lib/state.js';
import { DEFAULTS } from '../lib/config.js';
import { evaluate as evaluateO2 } from '../senses/o2.js';
import { evaluate as evaluateNociception } from '../senses/nociception.js';
import { evaluate as evaluateChronos } from '../senses/chronos.js';
import { evaluate as evaluateVestibular } from '../senses/vestibular.js';

const config = DEFAULTS.proprioception;

// Helper to build a state with N actions
function buildState(actions, overrides = {}) {
  const state = {
    session_id: 'test',
    session_start: new Date(Date.now() - 60000).toISOString(), // 1 min ago
    actions,
    baseline: {
      established: true,
      avg_token_velocity: 500,
      turns_sampled: 10,
    },
    nociception: {
      escalation_level: 0,
      cooldown_remaining: 0,
      last_intervention_at: null,
    },
    turn_count: actions.length,
    last_user_interaction: new Date(Date.now() - 60000).toISOString(),
    ...overrides,
  };
  return state;
}

function makeAction(overrides = {}) {
  return {
    tool_name: 'Bash',
    target_resource: 'npm test',
    action_type: 'execute',
    exit_status: 'success',
    error_signature: null,
    token_estimate: 500,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// --- O2 Tests ---
describe('O2 - Context Trend', () => {
  it('should return null when baseline not established', () => {
    const state = buildState([], { baseline: { established: false, avg_token_velocity: 0, turns_sampled: 3 } });
    const action = makeAction({ token_estimate: 5000 });
    assert.equal(evaluateO2(state, action, config), null);
  });

  it('should return null when velocity is normal', () => {
    const actions = [
      makeAction({ token_estimate: 400 }),
      makeAction({ token_estimate: 500 }),
      makeAction({ token_estimate: 600 }),
    ];
    const state = buildState(actions);
    const action = makeAction({ token_estimate: 500 });
    assert.equal(evaluateO2(state, action, config), null);
  });

  it('should signal when velocity spikes', () => {
    const actions = [
      makeAction({ token_estimate: 5000, action_type: 'read' }),
      makeAction({ token_estimate: 6000, action_type: 'read' }),
      makeAction({ token_estimate: 7000, action_type: 'read' }),
    ];
    const state = buildState(actions); // baseline is 500
    const action = makeAction({ token_estimate: 7000 });
    const signal = evaluateO2(state, action, config);
    assert.ok(signal, 'Should produce a signal');
    assert.ok(signal.includes('Context filling rapidly'), `Signal should mention context: ${signal}`);
  });
});

// --- Nociception Tests ---
describe('Nociception - Error Friction', () => {
  it('should return no signal when no errors', () => {
    const actions = [makeAction(), makeAction(), makeAction()];
    const state = buildState(actions);
    const result = evaluateNociception(state, makeAction(), config);
    assert.equal(result.signal, null);
    assert.equal(result.layer2, null);
  });

  it('should signal on consecutive similar errors', () => {
    const errSig = 'error: cannot find module str path n';
    const actions = [
      makeAction({ exit_status: 'error', error_signature: errSig }),
      makeAction({ exit_status: 'error', error_signature: errSig }),
      makeAction({ exit_status: 'error', error_signature: errSig }),
    ];
    const state = buildState(actions);
    const result = evaluateNociception(state, makeAction({ exit_status: 'error', error_signature: errSig }), config);
    assert.ok(result.signal, 'Should produce Layer 1 signal');
    assert.ok(result.layer2, 'Should produce Layer 2 intervention');
  });

  it('should NOT signal on different errors (exploring)', () => {
    const actions = [
      makeAction({ exit_status: 'error', error_signature: 'cannot find module foo' }),
      makeAction({ exit_status: 'error', error_signature: 'syntax error unexpected token' }),
      makeAction({ exit_status: 'error', error_signature: 'permission denied access file' }),
    ];
    const state = buildState(actions);
    const result = evaluateNociception(state, makeAction({ exit_status: 'error', error_signature: 'timeout connection refused' }), config);
    // Different errors should have low similarity
    assert.equal(result.layer2, null, 'Should NOT trigger Layer 2 for dissimilar errors');
  });

  it('should respect cooldown', () => {
    const errSig = 'error: cannot find module str';
    const actions = [
      makeAction({ exit_status: 'error', error_signature: errSig }),
      makeAction({ exit_status: 'error', error_signature: errSig }),
      makeAction({ exit_status: 'error', error_signature: errSig }),
    ];
    const state = buildState(actions, {
      nociception: { escalation_level: 1, cooldown_remaining: 3, last_intervention_at: 5 },
    });
    const result = evaluateNociception(state, makeAction({ exit_status: 'error', error_signature: errSig }), config);
    assert.equal(result.signal, null, 'Should be suppressed during cooldown');
  });
});

// --- Chronos Tests ---
describe('Chronos - Temporal Awareness', () => {
  it('should return null when session is young', () => {
    const state = buildState([makeAction()], {
      session_start: new Date().toISOString(),
      last_user_interaction: new Date().toISOString(),
      turn_count: 3,
    });
    const result = evaluateChronos(state, makeAction(), config);
    assert.equal(result, null);
  });

  it('should signal when time threshold exceeded', () => {
    const longAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 mins ago
    const state = buildState([makeAction()], {
      session_start: longAgo,
      last_user_interaction: longAgo,
      turn_count: 15,
    });
    const result = evaluateChronos(state, makeAction(), config);
    assert.ok(result, 'Should produce a signal after 20 minutes');
  });
});

// --- Vestibular Tests ---
describe('Vestibular - Action Diversity', () => {
  it('should return null for diverse actions', () => {
    const actions = [
      makeAction({ tool_name: 'Read', target_resource: '/src/a.ts' }),
      makeAction({ tool_name: 'Edit', target_resource: '/src/b.ts' }),
      makeAction({ tool_name: 'Bash', target_resource: 'npm test' }),
    ];
    const state = buildState(actions);
    const action = makeAction({ tool_name: 'Grep', target_resource: 'pattern' });
    const result = evaluateVestibular(state, action, config);
    assert.equal(result, null);
  });

  it('should signal on consecutive identical actions', () => {
    const actions = [
      makeAction({ tool_name: 'Grep', target_resource: 'findThisThing' }),
      makeAction({ tool_name: 'Grep', target_resource: 'findThisThing' }),
      makeAction({ tool_name: 'Grep', target_resource: 'findThisThing' }),
      makeAction({ tool_name: 'Grep', target_resource: 'findThisThing' }),
    ];
    const state = buildState(actions);
    const action = makeAction({ tool_name: 'Grep', target_resource: 'findThisThing' });
    const result = evaluateVestibular(state, action, config);
    assert.ok(result, 'Should detect circular action pattern');
  });
});

// --- Token estimation ---
describe('Token Estimation', () => {
  it('should estimate ~250 tokens for 1000 chars', () => {
    const text = 'a'.repeat(1000);
    const estimate = estimateTokens(text);
    assert.equal(estimate, 250);
  });

  it('should handle null/undefined', () => {
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });
});
