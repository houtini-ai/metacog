# Metacog: Proprioceptive Nervous System for AI Agents

## Elevator Pitch

AI coding agents operate like brains in vats - they process inputs and emit outputs with zero awareness of their own operational state. They can't feel their context window filling up, don't know how long they've been working, can't sense when they're going in circles, and have no peripheral vision of how their changes affect the wider codebase. Metacog gives agents a nervous system. It provides continuous, low-cost proprioceptive signals that let the agent *feel* its own state and self-correct before failures occur - without external micromanagement, without activity logging, and without bloating the context window.

## Theoretical Foundation

### Why not activity logs?

Systems like Claude-Mem (github.com/thedotmack/claude-mem) record what the agent *did* (episodic memory). This is fundamentally flawed:
- **Stale data**: observations about code state become misleading as code changes
- **Token tax**: every retrieval costs tokens whether useful or not
- **No learning**: replaying actions isn't reflection, it's a search engine over a diary
- **Unbounded growth**: 619 files of infrastructure to maintain a growing database of diminishing-value records

See `research/claude-mem-review.md` for full analysis.

### The Experiential RL insight (arxiv 2602.13949)

Training-time reflection on failures (not successes) improves performance by up to 81%. Key principles that inform this design:
- Reflect only on failures (success reflection causes reward hacking)
- Self-generated reflection > externally provided corrections
- Lessons must be internalized, not just replayed
- Stale reflections can poison future performance
- Excessive self-monitoring degrades performance (analysis paralysis)

See `research/erl-paper-notes.md` for full analysis.

### Distributed cognition

Since we can't fine-tune model weights mid-session, metacognition lives in the *system* (agent + sidecar), not in either component alone. This is consistent with the Extended Mind Thesis (Clark & Chalmers) - humans also distribute executive function into journals, checklists, and mentors.

### The proprioception metaphor

Biological intelligence doesn't avoid walking into walls because a "Collision Detection Module" writes a report about a recent impact. We avoid walls because proprioception provides immediate, low-latency, non-verbal feedback about our physical state and boundaries.

The key insight: **don't build a critic that judges the agent. Build a nervous system that lets the agent feel.**

---

## Core Design Principles

1. **No news is good news** - signals are only injected when values deviate from baseline. The absence of a signal means everything is fine. This prevents alert fatigue and avoids the irony of a context-monitoring system consuming context.

2. **Trends over absolutes** - we measure velocity and trajectory, not absolute values. We can't know the exact context window size, so we track "filling rapidly" not "88% full." This is honest about measurement limits and resilient to infrastructure changes.

3. **Inform, don't command** - proprioceptive signals provide awareness. The agent's native reasoning decides what to do about it. We trust the agent. Only at extreme thresholds does the system force a cognitive shift.

4. **Graceful degradation** - if the sidecar fails, the agent is just normal Claude. Nothing breaks. The system adds capability without creating dependency.

5. **Future-proof** - no signal depends on a specific implementation detail of the host platform. If Anthropic changes compaction algorithms, context limits, or tool interfaces tomorrow, the proprioceptive signals still work because they measure behavioral trends, not internal state.

---

## Architecture: Hybrid Hook + MCP

### Why hybrid?

| Approach | Pros | Cons |
|----------|------|------|
| Hook only | Silent, automatic | Stateless, limited logic |
| MCP only | Stateful, rich tools | Agent must choose to call it |
| Skill only | Can define protocols | Invoked, not continuous |
| **Hybrid Hook + MCP** | **Silent monitoring + stateful intelligence** | **Two components to maintain** |

### Component Roles

**The Hook (Autonomic Nervous System)** - Claude Code `PostToolUse` hook
- Fires silently after every tool call
- Writes lightweight JSON telemetry to ephemeral state file (`.claude/metacog.state.json`)
- Reads current state, evaluates thresholds
- When thresholds are breached: outputs to stderr with exit code 2 (injects system message)
- When thresholds are normal: exits silently with code 0 (zero token cost)

**The MCP Server (Higher Cognitive Functions)** - Persistent background process
- Reads telemetry state file, maintains sliding windows and baselines
- Provides explicit tools for voluntary metacognitive actions (`push_goal`, `pop_goal`)
- Handles boundary micro-reflections when failures resolve
- Manages correction rule database with confidence/decay
- Syncs durable insights to project memory files (materialized view pattern)

**State File** (`.claude/metacog.state.json`) - Bridge between hook and MCP
- Written by hook on every tool call (append to rolling buffer)
- Read by MCP for analysis and threshold computation
- Ephemeral - cleared on session end
- Contains only the last ~20 actions (fixed-size rolling window)

---

## The Three Layers

### Layer 1: Proprioception (Always On, Near-Zero Cost)

Continuous calculation of operational state signals. Injected into the agent's context **only when values deviate from baseline**. Most turns: zero injection, zero overhead.

#### The Five Senses

**1. O2 - Context Trend (Priority 1: Survival)**

The agent cannot see its own context window filling. This is its most critical blindspot - context overflow triggers compaction, which erases in-progress work and causes infinite retry loops.

- **What it measures**: Token consumption velocity - tokens consumed per turn, compared to session baseline
- **Baseline**: Average token consumption over first 10 tool calls
- **Trigger**: Token velocity spikes > 3x baseline (e.g., large file reads, verbose command output)
- **Signal**: `[Proprioception: Context filling rapidly - 3 large file reads in last 5 actions. Consider summarizing findings before proceeding.]`
- **Why trends, not percentages**: We cannot know the actual context limit or compaction threshold. A velocity spike is an honest, measurable signal that doesn't pretend to know more than it does.

**2. Chronos - Temporal Awareness (Priority 2: Efficiency)**

The agent has no sense of time. A 45-minute task feels identical to a 2-minute task. This blindspot prevents appropriate escalation decisions.

- **What it measures**: Wall-clock time elapsed, tool call count since session start or since last user message
- **Trigger**: > 15 minutes or > 20 tool calls without user interaction
- **Signal**: `[Proprioception: T+22 minutes, 18 tool calls on current task. Consider whether to continue or escalate to the user.]`

**3. Nociception - Error Friction (Priority 3: Pain)**

The agent doesn't aggregate its own error rate. Individual errors are visible but the *pattern* of repeated failure is not.

- **What it measures**: Ratio of failed to successful tool calls in sliding window. Similarity between consecutive error messages (fuzzy hash comparison).
- **Trigger**: 3+ non-zero exit codes in a 5-turn window, OR >70% error signature similarity between consecutive errors
- **Signal**: `[Proprioception: Error friction elevated - 3 consecutive similar failures on the same target.]`
- **Key discriminator**: Same error = stuck (signal fires). Different errors = exploring (signal suppressed).

**4. Spatial - Blast Radius (Priority 4: Awareness)**

The agent is inherently myopic - it only "sees" the file it's currently editing. It has no peripheral vision of how changes propagate through the codebase.

- **What it measures**: After any file write, fast dependency scan (`grep -r "import.*filename"` or cached dependency graph) to count files that reference the modified module.
- **Trigger**: > 3 files import/reference the modified file
- **Signal**: `[Proprioception: You modified router.ts. 6 other files import this module.]`
- **Non-judgmental**: Doesn't say "be careful." Just provides the fact. The agent's reasoning handles the rest.

**5. Vestibular - Action Diversity (Priority 5: Orientation)**

The agent can enter silent loops - repeating the same searches, reading the same files, running the same commands - without realizing it's going in circles.

- **What it measures**: Similarity between consecutive tool calls (tool name + target resource). Levenshtein distance or token overlap.
- **Trigger**: > 3 consecutive highly similar non-error actions (>80% similarity), OR >50% of current action window matches a previous window (re-reading files already read)
- **Signal**: `[Proprioception: You appear to be repeating actions from earlier in the session. You have read these files before.]`

### Layer 2: Nociception (Triggered by Layer 1 Thresholds)

When proprioceptive signals cross critical thresholds, the system forces a cognitive shift. This is not a gentle informational signal - it's a pain response that demands the agent stop and reflect.

**Activation**: Any Layer 1 signal fires 3+ times without resolution, OR a single signal reaches critical severity.

**Mechanism**: Hook exits with code 2, injecting a Socratic prompt that forces self-generated reflection:

```
[NOCICEPTIVE INTERRUPT]
You have been working on this for 28 minutes with 4 consecutive similar errors.
Before taking another action:
1. State the assumption you are currently operating on
2. Describe what read-only action would falsify that assumption
3. Execute that investigation before writing any more code
```

**Why Socratic, not directive**: The ERL paper showed that self-generated reflection drives behavioral change. Telling the agent "do X instead" is external correction. Forcing the agent to articulate its own assumption creates genuine cognitive engagement.

**Escalation ladder**:
- 1st nociceptive event: Socratic prompt (force reflection)
- 2nd nociceptive event: Directive prompt (read documentation/source)
- 3rd nociceptive event: Hard escalation to user ("I appear to be stuck - should we reassess the approach?")

**Reflex arc** (critical threshold): If Layer 1 detects 10+ consecutive failures with identical edits, the system doesn't ask - it forces: `"CRITICAL: You must stop modifying this file and ask the user for guidance."`

**Cooldown**: After any nociceptive intervention, suppress further interventions for 5 tool calls to prevent alert fatigue.

### Layer 3: Motor Learning (Triggered by Layer 2 Resolution)

When a nociceptive event resolves (the agent breaks out of a failure loop and succeeds), the system extracts a durable lesson. This is not an activity log - it captures the *delta between assumption and reality*.

**Activation**: A Layer 2 event was active, and the agent's subsequent actions return Layer 1 signals to baseline (success achieved).

**Process (Boundary Micro-Reflection)**:
1. Identify the failure window: first error to resolution
2. Extract: the persistent error, the final diff/action that fixed it
3. Generate a correction rule (small/fast model call, minimal context - just the delta)
4. Store as a structured rule with initial confidence 0.6

**Correction Rule Format**:
```yaml
type: correction
trigger:
  file_pattern: "*.config.*"
  error_class: "module_resolution"
assumption_that_failed: "Webpack aliases are automatically available in Jest"
actual_state: "Jest requires its own moduleNameMapper configuration"
rule: "When modifying path aliases, check both webpack.config.js AND jest.config.js"
confidence: 0.6
scope:
  project: "frontend-app"
  directories: ["src/", "test/"]
validated_count: 1
last_validated: "2026-03-17"
```

**Key properties**:
- Captures cognitive blind spots, not activity history
- Confidence increases with validation, decreases with contradiction
- Scoped to specific files/directories/patterns
- Always injected as hypotheses to test, never as authoritative facts
- Rules below confidence threshold are permanently deleted (active forgetting)

**CLAUDE.md Integration (Materialized View Pattern)**:
- MCP database is source of truth (confidence scores, validation counts, decay)
- Human-readable projection synced to project memory files
- User can see, edit, or delete rules (transparency + human override)
- User deletions feed back to MCP as strong negative signal
- Framing in memory files: "In past sessions, the following patterns were observed - verify before relying on these"

---

## Threshold Configuration

Static defaults, user-configurable. Sensible out of the box, tunable for specific workflows.

```yaml
# .claude/metacog.config.yaml

proprioception:
  o2:
    velocity_multiplier: 3        # trigger when token velocity > baseline * N
    baseline_window: 10           # turns to establish baseline
  chronos:
    time_threshold_minutes: 15    # trigger after N minutes without user interaction
    step_threshold: 20            # trigger after N tool calls without user interaction
  nociception:
    consecutive_errors: 3         # errors in sliding window before signal
    error_similarity: 0.7         # threshold for "same error" detection
    window_size: 5                # sliding window for error rate
  spatial:
    blast_radius_threshold: 3     # file imports before signaling
  vestibular:
    action_similarity: 0.8        # threshold for "same action" detection
    consecutive_similar: 3        # consecutive similar actions before signal

nociception:
  escalation_cooldown: 5          # turns of silence after intervention
  reflex_arc_threshold: 10        # consecutive failures before hard escalation

motor_learning:
  initial_confidence: 0.6         # starting confidence for new rules
  decay_threshold: 0.3            # confidence below which rules are deleted
  max_rules_per_project: 50       # prevent rule accumulation
```

---

## What Metacog Is

- A nervous system that gives agents proprioceptive awareness
- A pain response that forces reflection when things go wrong
- A motor learning system that extracts durable lessons from resolved failures
- A passive telemetry layer with near-zero overhead when things are going well

## What Metacog Is NOT

- **Not a memory system** - it doesn't record what happened
- **Not an activity logger** - it doesn't store tool call history beyond a 20-item rolling window
- **Not a search engine** - there's nothing to search; rules are small and scoped
- **Not a micromanager** - it doesn't demand hypothesis declarations unless pain signals fire
- **Not Claude-Mem** - it gives the agent senses, not a diary

---

## Implementation Roadmap

### Phase 1: Core Proprioception
- PostToolUse hook (node script)
- Ephemeral state file with rolling action window
- O2 (context trend) + Nociception (error friction) signals
- Signal injection only on deviation from baseline
- **Zero dependencies beyond Claude Code hooks and a JSON file**
- **Immediate value on first use**

### Phase 2: Full Sensory Suite
- Add Chronos (temporal awareness), Vestibular (action diversity), Spatial (blast radius)
- MCP server for stateful analysis and optional goal management tools
- Hook→MCP communication via state file or localhost HTTP

### Phase 3: Nociceptive Response
- Escalation ladder (Socratic → directive → user escalation)
- Reflex arc for critical thresholds
- Cooldown mechanics

### Phase 4: Motor Learning
- Boundary micro-reflection generation
- Correction rule storage with confidence/decay
- CLAUDE.md sync (materialized view pattern)
- Active forgetting

### Phase 5 (Research): Higher-Order Metacognition
- Goal stack + scope drift detection
- Cross-session strategy patterns
- Confidence-action alignment analytics

---

## Open Questions

1. **Token estimation accuracy**: How reliably can we estimate token consumption from text length alone? Is character count / 4 sufficient, or do we need tiktoken?
2. **Error signature algorithm**: Simple token overlap? Levenshtein? Fuzzy hash? Need to test against real error patterns from actual sessions.
3. **Blast radius performance**: How fast is `grep -r` for import detection on large codebases? Do we need a cached dependency graph?
4. **Hook latency budget**: What's the acceptable latency per PostToolUse hook invocation? Need to benchmark.
5. **Multi-agent sessions**: When the agent spawns subagents, does each get its own proprioceptive state? Or is there a shared session state?
6. **Compaction interaction**: When compaction occurs, does it remove previous proprioceptive signals from context? (Desirable - they're ephemeral by design.)

---

*Specification developed collaboratively by Claude (Opus) and Gemini (3.1 Pro Preview) on 2026-03-17.*
*Theoretical foundations: Experiential RL (arxiv 2602.13949), Extended Mind Thesis (Clark & Chalmers), biological proprioception and nociception.*
