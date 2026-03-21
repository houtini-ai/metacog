import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readState, createAction, appendAction, estimateTokens, estimateTokensFromHook } from '../lib/state.js';
import { DEFAULTS } from '../lib/config.js';
import { extractLearnings, buildPatternDetectors, extractMotorLearning } from '../lib/learnings.js';
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

// --- Fix #1: estimateTokensFromHook ---
describe('estimateTokensFromHook', () => {
  it('should estimate from both tool_input and tool_result', () => {
    const hookInput = {
      tool_input: 'a'.repeat(400),   // 100 tokens
      tool_result: 'b'.repeat(800),  // 200 tokens
    };
    const estimate = estimateTokensFromHook(hookInput);
    assert.equal(estimate, 300);
  });

  it('should estimate from tool_input only when tool_result is missing', () => {
    const hookInput = { tool_input: 'a'.repeat(400) };
    const estimate = estimateTokensFromHook(hookInput);
    assert.equal(estimate, 100);
  });

  it('should estimate from tool_result only when tool_input is missing', () => {
    const hookInput = { tool_result: 'b'.repeat(800) };
    const estimate = estimateTokensFromHook(hookInput);
    assert.equal(estimate, 200);
  });

  it('should fall back to full payload when both fields are empty', () => {
    const hookInput = { tool_name: 'Read', some_field: 'x'.repeat(80) };
    const estimate = estimateTokensFromHook(hookInput);
    assert.ok(estimate > 0, 'Should estimate from full payload');
  });

  it('should handle null/undefined input', () => {
    assert.equal(estimateTokensFromHook(null), 0);
    assert.equal(estimateTokensFromHook(undefined), 0);
  });

  it('should handle object tool_input', () => {
    const hookInput = { tool_input: { file_path: '/foo/bar.js', content: 'x'.repeat(400) } };
    const estimate = estimateTokensFromHook(hookInput);
    assert.ok(estimate > 0, 'Should stringify objects');
  });
});

// --- Fix #2: Motor Learning ---
describe('Motor Learning - extractMotorLearning', () => {
  it('should extract learning when errors resolve', () => {
    const actions = [
      makeAction({ exit_status: 'success', tool_name: 'Read', target_resource: '/src/a.ts' }),
      makeAction({ exit_status: 'error', tool_name: 'Edit', target_resource: '/src/b.ts', error_signature: 'syntax error unexpected token' }),
      makeAction({ exit_status: 'error', tool_name: 'Edit', target_resource: '/src/b.ts', error_signature: 'syntax error unexpected token' }),
      makeAction({ exit_status: 'error', tool_name: 'Edit', target_resource: '/src/b.ts', error_signature: 'syntax error unexpected token' }),
      makeAction({ exit_status: 'success', tool_name: 'Read', target_resource: '/src/docs.md' }),
      makeAction({ exit_status: 'success', tool_name: 'Edit', target_resource: '/src/b.ts' }),
    ];
    const state = buildState(actions, {
      nociception: { escalation_level: 2, cooldown_remaining: 0, last_intervention_at: 3 },
    });
    const learning = extractMotorLearning(state);
    assert.ok(learning, 'Should produce a motor learning');
    assert.equal(learning.type, 'motor_learning');
    assert.equal(learning.category, 'Resolved Failures');
    assert.equal(learning.failure_window.error_count, 3);
    assert.ok(learning.lesson.includes('resolution came from'), `Lesson should describe resolution: ${learning.lesson}`);
  });

  it('should return null when no errors in window', () => {
    const actions = [
      makeAction({ exit_status: 'success' }),
      makeAction({ exit_status: 'success' }),
      makeAction({ exit_status: 'success' }),
    ];
    const state = buildState(actions);
    assert.equal(extractMotorLearning(state), null);
  });

  it('should return null when errors are still ongoing (no resolution)', () => {
    const actions = [
      makeAction({ exit_status: 'error', error_signature: 'err' }),
      makeAction({ exit_status: 'error', error_signature: 'err' }),
      makeAction({ exit_status: 'error', error_signature: 'err' }),
    ];
    const state = buildState(actions);
    // resolutionStart would be after last error = actions.length, no resolution actions
    assert.equal(extractMotorLearning(state), null);
  });

  it('should detect tool switch as resolution strategy', () => {
    const actions = [
      makeAction({ exit_status: 'error', tool_name: 'Bash', target_resource: 'npm test', error_signature: 'test failed' }),
      makeAction({ exit_status: 'error', tool_name: 'Bash', target_resource: 'npm test', error_signature: 'test failed' }),
      makeAction({ exit_status: 'success', tool_name: 'Read', target_resource: '/src/config.js' }),
    ];
    const state = buildState(actions);
    const learning = extractMotorLearning(state);
    assert.ok(learning, 'Should produce learning');
    assert.ok(learning.lesson.includes('switching from'), `Should detect tool switch: ${learning.lesson}`);
  });

  it('should return null with fewer than 2 failure actions', () => {
    const actions = [
      makeAction({ exit_status: 'error', error_signature: 'err' }),
      makeAction({ exit_status: 'success' }),
    ];
    const state = buildState(actions);
    assert.equal(extractMotorLearning(state), null);
  });
});

// --- Fix #3: Suppression preconditions ---
describe('Suppression Preconditions', () => {
  it('should NOT emit circular_search suppression when no reads occurred', () => {
    // Session with only write/execute actions — circular_search precondition not met
    const actions = [
      makeAction({ tool_name: 'Edit', action_type: 'write' }),
      makeAction({ tool_name: 'Bash', action_type: 'execute' }),
      makeAction({ tool_name: 'Edit', action_type: 'write' }),
    ];
    const state = buildState(actions, { turn_count: 10 });
    const learnings = extractLearnings(state, ['circular_search']);
    const suppression = learnings.find(l => l.pattern === 'circular_search' && l.type === 'suppression');
    assert.equal(suppression, undefined, 'Should not emit suppression when precondition not met');
  });

  it('should emit circular_search suppression when reads occurred but no circular pattern', () => {
    // Session with diverse reads — precondition met, pattern didn't fire
    const actions = [
      makeAction({ tool_name: 'Read', action_type: 'read', target_resource: '/a.ts' }),
      makeAction({ tool_name: 'Edit', action_type: 'write', target_resource: '/a.ts' }),
      makeAction({ tool_name: 'Read', action_type: 'read', target_resource: '/b.ts' }),
      makeAction({ tool_name: 'Bash', action_type: 'execute' }),
    ];
    const state = buildState(actions, { turn_count: 10 });
    const learnings = extractLearnings(state, ['circular_search']);
    const suppression = learnings.find(l => l.pattern === 'circular_search' && l.type === 'suppression');
    assert.ok(suppression, 'Should emit suppression when precondition met but pattern did not fire');
  });

  it('should NOT emit error_loop suppression when no errors occurred', () => {
    const actions = [
      makeAction({ exit_status: 'success' }),
      makeAction({ exit_status: 'success' }),
    ];
    const state = buildState(actions, { turn_count: 10 });
    const learnings = extractLearnings(state, ['error_loop']);
    const suppression = learnings.find(l => l.pattern === 'error_loop' && l.type === 'suppression');
    assert.equal(suppression, undefined, 'Should not emit suppression when no errors happened');
  });

  it('should NOT emit long_autonomous_run suppression for short sessions', () => {
    const actions = [makeAction(), makeAction()];
    const state = buildState(actions, { turn_count: 5 });
    const learnings = extractLearnings(state, ['long_autonomous_run']);
    const suppression = learnings.find(l => l.pattern === 'long_autonomous_run' && l.type === 'suppression');
    assert.equal(suppression, undefined, 'Should not emit suppression for very short sessions');
  });
});

// --- Fix #5: Configurable detectors ---
describe('Configurable Pattern Detectors', () => {
  it('should build detectors with default thresholds', () => {
    const detectors = buildPatternDetectors();
    assert.equal(detectors.length, 5, 'Should have all 5 built-in detectors');
  });

  it('should exclude disabled detectors', () => {
    const detectors = buildPatternDetectors({
      circular_search: { enabled: false },
      error_loop: { enabled: false },
    });
    assert.equal(detectors.length, 3, 'Should exclude 2 disabled detectors');
    const ids = detectors.map(d => d.id);
    assert.ok(!ids.includes('circular_search'), 'circular_search should be excluded');
    assert.ok(!ids.includes('error_loop'), 'error_loop should be excluded');
  });

  it('should respect custom thresholds', () => {
    const detectors = buildPatternDetectors({
      long_autonomous_run: { turn_threshold: 100 },
    });
    const lar = detectors.find(d => d.id === 'long_autonomous_run');
    assert.ok(lar, 'long_autonomous_run should exist');
    // Should NOT fire at 60 turns with threshold=100
    const state60 = buildState([], { turn_count: 60 });
    assert.equal(lar.detect(state60), null, 'Should not fire at 60 with threshold=100');
    // Should fire at 101
    const state101 = buildState([], { turn_count: 101 });
    const result = lar.detect(state101);
    assert.ok(result, 'Should fire at 101 with threshold=100');
    assert.ok(result.lesson.includes('100'), 'Lesson should mention custom threshold');
  });

  it('should pass custom detectors to extractLearnings', () => {
    const customDetector = {
      id: 'test_custom',
      relevantTools: [],
      preconditionMet() { return true; },
      detect(state) {
        if (state.turn_count > 3) {
          return { pattern: 'test_custom', category: 'Test', lesson: 'Test lesson' };
        }
        return null;
      },
    };
    const state = buildState([makeAction(), makeAction(), makeAction(), makeAction()], { turn_count: 5 });
    const learnings = extractLearnings(state, [], [customDetector]);
    const detection = learnings.find(l => l.pattern === 'test_custom');
    assert.ok(detection, 'Custom detector should fire');
    assert.equal(detection.type, 'detection');
  });
});
