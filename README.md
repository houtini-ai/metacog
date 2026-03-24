# metacog

[![npm version](https://img.shields.io/npm/v/@houtini/metacog.svg?style=flat-square)](https://www.npmjs.com/package/@houtini/metacog)
[![Known Vulnerabilities](https://snyk.io/test/github/houtini-ai/metacog/badge.svg)](https://snyk.io/test/github/houtini-ai/metacog)

<p align="center">
  <img src="assets/icon.png" alt="metacog" width="128">
</p>

So, here's the problem with AI coding agents: they can't feel when they're stuck. They'll retry the same broken fix five times because they can see each individual error but not the *pattern* of repeated failure. They'll read the same file three times in a session because context compaction wiped their memory of reading it. They'll chase a dependency chain four levels deep and forget what they were originally trying to fix. They have no sense of time, no peripheral vision of how their changes affect other files, and no awareness of whether they're actually validating their work or just admiring it.

Metacog is a pair of Claude Code hooks that gives the agent something like a nervous system. I say "something like" because the signals arrive as text in the agent's context, not as actual sensations. It's closer to a colleague leaving a post-it note than biological proprioception. But that turns out to be enough. One hook fires after every tool call and watches for these patterns. The other fires when you send a message and injects learned rules from past sessions. When everything is fine, both hooks are completely silent, zero tokens, zero cost. When something is off, a short signal appears in the agent's context. At first it's just awareness, and the agent's own reasoning decides what to do about it. But if the agent keeps failing, the signals escalate from gentle nudges to structured interventions that force the agent to stop and rethink. That escalation matters, because if the agent's reasoning was working properly it wouldn't be stuck in the first place.

And when problems do resolve, the system extracts what changed and persists it as a behavioural rule that gets injected into future sessions. This is probably the most interesting part. Most cross-session memory systems use time-decay, so if a rule works and the failure stops happening, the system sees silence and prunes the rule. The agent forgets. The behaviour regresses. Metacog inverts this: if the rule was active and the failure's preconditions were met but the failure *didn't* happen, that counts as evidence the rule is working. Rules get stronger when they succeed, not stale.

Seven senses. Session retrospectives. User interaction tracking. Zero dependencies. One-command install. Open source.

> **Quick Navigation**
>
> [Install](#install) | [What are hooks?](#what-are-claude-code-hooks) | [What it does](#what-it-does) | [The seven senses](#the-seven-senses) | [The three layers](#the-three-layers) | [Memory vs. metacognition](#memory-vs-metacognition) | [Session retrospectives](#session-retrospectives) | [User interaction tracking](#user-interaction-tracking) | [How the data flows](#how-the-data-flows) | [Configuration](#configuration) | [Plugin structure](#plugin-structure) | [Design principles](#design-principles)

---

## Install

### From npm

```bash
npx @houtini/metacog --install
```

This downloads the package and registers both hooks into your global Claude Code settings (`~/.claude/settings.json`). Metacog runs silently in the background from that point on. You'll only see output when something is abnormal.

For project-scoped install (writes to `.claude/settings.json` in the current directory):

```bash
npx @houtini/metacog --install --project
```

### From source

```bash
git clone https://github.com/houtini-ai/metacog
cd metacog && node src/install.js --install
```

This points the hooks at your local clone, so changes take effect immediately.

---

## What are Claude Code hooks?

Hooks are shell commands that Claude Code runs automatically at specific moments during a session. They're the plugin system's way of letting tools react to what the agent is doing, without the agent having to ask for it.

There are a few hook events that matter here:

| Hook event | When it fires | What it's for |
|------------|--------------|---------------|
| `PostToolUse` | After the agent uses any tool (Read, Write, Bash, etc.) | Monitoring, validation, side effects |
| `UserPromptSubmit` | When you send a message | Injecting context, session setup |
| `PreToolUse` | Before a tool runs | Blocking dangerous actions |
| `Stop` | When the agent finishes responding | Cleanup, verification |

Hooks communicate back to Claude via JSON on stdout:

```json
{
  "continue": true,
  "suppressOutput": false,
  "systemMessage": "This message appears in the agent's context"
}
```

If a hook outputs nothing and exits 0, it's invisible. Zero token cost. Zero latency (well, near-zero). This is what makes hooks different from MCP servers - they can be completely silent when there's nothing to say.

Metacog uses two hooks: `PostToolUse` for the nervous system and `UserPromptSubmit` for injecting learned rules, session retrospectives, and tracking user interaction patterns.

---

## What it does

Metacog runs as a pair of Claude Code hooks. One fires after every tool call (the nervous system), the other fires on every user message (interaction tracking, digest injection, session retrospectives). When everything is normal, both produce zero output and cost zero tokens. When something is abnormal, a short signal appears in the agent's context. Most of the time this is just awareness, and the agent decides what to do. But when the agent is genuinely stuck, the system escalates to structured interventions that force reflection before the agent can continue.

### The seven senses

| Sense | Signal | What it detects |
|-------|--------|-----------------|
| **O2** | Context trend | Token velocity spikes, the agent is consuming context unsustainably |
| **Chronos** | Temporal awareness | Time and step count since last user interaction |
| **Nociception** | Error friction | Repeated similar errors, the agent is stuck |
| **Spatial** | Blast radius | File dependency count after writes |
| **Vestibular** | Action diversity | Repeated identical actions, going in circles |
| **Echo** | Validation bias | Writing code without running tests, or validating against own output instead of the project's test suite |
| **Drift** | Scope drift | Recent actions have diverged from the original task, chasing dependency chains instead of solving the problem |

### The three layers

<div align="center">
  <img src="docs/five-senses.png" alt="Proprioceptive Senses" width="700">
</div>

**Layer 1: Proprioception** (always on, near-zero cost)
Calculates all seven senses after every tool call. Injects a signal only when values deviate from baseline. Most turns: completely silent.

```
[Metacognition — review and ignore if not relevant]
Context velocity is high (3 large file reads in last 5 actions).
Does your current approach need all this context, or could an Agent subagent handle the remaining exploration?
```

**Layer 2: Nociception** (triggered by Layer 1 thresholds)
When error friction crosses critical thresholds, escalating interventions kick in - Socratic questioning first, then directive instructions, then flagging the user.

```
[NOCICEPTIVE INTERRUPT]
You have attempted 4 similar fixes with consecutive similar errors.
Before taking another action:
1. State the assumption you are currently operating on
2. Describe what read-only action would falsify that assumption
3. Execute that investigation before writing any more code
```

**Layer 3: Motor Learning** (cross-session)
When a nociceptive event resolves, the system extracts what changed. The delta between failure and resolution gets persisted as a behavioural lesson and injected into future sessions.

---

## Memory vs. metacognition

Memory plugins do a real job. They persist what the agent knows across sessions: user preferences, project context, decisions made. Claude Code's built-in memory system does this well.

But memory answers "what happened?" Metacog answers "how am I thinking right now?" It's the difference between a journal and a nervous system. One records the past. The other tells you when your hand is on the stove.

<div align="center">
  <img src="docs/memory-trap.png" alt="Memory and Metacognition" width="700">
</div>

Metacog doesn't replace memory. It complements it by tracking *how the agent reasons*, what patterns lead to failure, what changes fix them, and building rules that get more confident over time.

### The seesaw problem

Standard time-decay actively punishes success. If the agent learns "don't retry the same error three times" and stops doing it, the decay system sees the rule going stale and prunes it. The agent forgets. The behaviour regresses.

<div align="center">
  <img src="docs/seesaw-problem.png" alt="The Seesaw Problem" width="700">
</div>

Metacog inverts this. When a known pattern *doesn't* fire during a session where its rule was active, that's a **suppression** - evidence the rule is working. Both detections and suppressions increase confidence. Only truly dormant rules decay.

<div align="center">
  <img src="docs/reinforcement-tracking.png" alt="Reinforcement Tracking" width="700">
</div>

### Subagent awareness

When the agent delegates work to a subagent, the subagent's tool calls can inflate turn counts and token velocity, triggering false positives from Chronos and O2. Metacog detects Agent tool calls and suppresses these senses during delegation, so productive delegation isn't penalised.

### Session retrospectives

At the start of each session, metacog injects a brief retrospective of the prior session: which senses fired, action distribution, nociceptive events, delegation patterns, and user interaction quality. This gives the agent immediate context about what happened before without needing to search history.

```
[Metacog — Prior Session Retrospective]
Last session: 57 tool calls over 9 min.
Senses that fired: O2 (context velocity), Chronos (level 2).
1 subagent delegation used.
Action mix: 14 reads, 0 writes, 5 executes
2 user messages, avg 28 tool calls between messages, prompts were mostly broad/exploratory
```

### User interaction tracking

The `UserPromptSubmit` hook analyses each user message for specificity (file paths, line numbers, identifiers, error text) and tracks interaction patterns across the session. This isn't about judging prompt quality. Vague prompts are appropriate for exploratory work. But when there's a measurable correlation between prompt style and session length in a specific project, that's worth surfacing. The system shows the data and lets you decide what to do with it.

```
[Metacog — Collaboration Patterns]
Sessions where prompts mentioned specific files averaged 12 tool calls.
Sessions without averaged 38. This project may benefit from targeted prompts.
```

---

## How the data flows

**Session start** - the `UserPromptSubmit` hook compiles all learnings (global + project-scoped) into a digest, builds a retrospective of the prior session, and injects both as a system message. A marker file records which patterns were active.

**Every user message** - the `UserPromptSubmit` hook captures a task fingerprint (for scope drift detection) and records interaction metadata (prompt specificity, tool calls between messages, active signals).

**During the session** - the `PostToolUse` hook fires after every tool call. It records actions into a rolling 20-item window. Silent when normal. Signals when abnormal.

**Session end** - when the next session starts, the system:
1. Reads the active patterns from the previous session
2. Runs all pattern detectors against the session state
3. Detections: the failure happened
4. Suppressions: the rule was active, its preconditions were met, but the failure didn't happen (evidence the rule worked)
5. Persists both to JSONL - global and project-scoped

### Per-project scoping

Learnings are stored at two levels:

- **Global** (`~/.claude/metacog-learnings.jsonl`) - patterns that apply everywhere
- **Project** (`<project>/.claude/metacog-learnings.jsonl`) - patterns specific to this codebase

Project-scoped entries take precedence where they overlap.

---

## Configuration

Metacog works with zero configuration. To tune thresholds, create `.claude/metacog.config.json` in your project:

```json
{
  "proprioception": {
    "o2": {
      "velocity_multiplier": 3,
      "baseline_window": 10
    },
    "chronos": {
      "time_threshold_minutes": 15,
      "step_threshold": 25
    },
    "nociception": {
      "consecutive_errors": 3,
      "error_similarity": 0.6,
      "window_size": 5
    },
    "spatial": {
      "blast_radius_threshold": 5,
      "enabled": true
    },
    "vestibular": {
      "action_similarity": 0.8,
      "consecutive_similar": 4
    },
    "echo": {
      "write_streak_threshold": 5,
      "cooldown": 8
    },
    "drift": {
      "min_actions": 8,
      "recent_window": 5,
      "drift_threshold": 0.15,
      "cooldown": 10
    }
  },
  "nociception": {
    "escalation_cooldown": 5,
    "reflex_arc_threshold": 8
  }
}
```

| Setting | Default | What it does |
|---------|---------|-------------|
| `o2.velocity_multiplier` | 3 | Trigger when token velocity exceeds baseline by this factor |
| `chronos.time_threshold_minutes` | 15 | Signal after this many minutes without user interaction |
| `chronos.step_threshold` | 25 | Signal after this many tool calls without user interaction |
| `nociception.consecutive_errors` | 3 | Similar errors before signalling |
| `spatial.blast_radius_threshold` | 5 | File imports before signalling |
| `vestibular.consecutive_similar` | 4 | Identical actions before signalling |
| `echo.write_streak_threshold` | 5 | Consecutive writes without test run before signalling |
| `drift.min_actions` | 8 | Minimum actions before drift detection starts |
| `drift.drift_threshold` | 0.15 | Term overlap ratio below which drift is signalled |

### Pattern detectors

The cross-session learning detectors are configurable. Tune thresholds or disable individual detectors:

```json
{
  "patterns": {
    "circular_search": { "enabled": true, "consecutive_runs": 2 },
    "repeated_file_read": { "enabled": true, "repeat_threshold": 3 },
    "error_loop": { "enabled": true, "recent_window": 10, "min_errors": 4, "max_unique_sigs": 2 },
    "long_autonomous_run": { "enabled": true, "turn_threshold": 50 },
    "write_heavy_session": { "enabled": true, "min_writes": 10, "read_ratio": 0.5 }
  }
}
```

### Custom pattern detectors

Define your own detectors in JSON:

```json
{
  "custom_patterns_path": ".claude/my-patterns.json"
}
```

```json
[
  {
    "id": "too_many_bash_calls",
    "category": "Execution Patterns",
    "lesson": "Consider using dedicated tools (Read, Grep) instead of Bash for file operations.",
    "relevant_tools": ["Bash"],
    "condition": {
      "type": "count_exceeds",
      "filter": { "tool_name": "Bash" },
      "threshold": 15
    }
  }
]
```

Supported condition types: `count_exceeds`, `consecutive_exceeds`, `ratio_exceeds`.

---

## Plugin structure

```
metacog/
├── .claude-plugin/
│   ├── plugin.json           # Plugin identity
│   └── marketplace.json      # Marketplace distribution
├── hooks/
│   └── hooks.json            # Hook event configuration
├── src/
│   ├── hook.js               # PostToolUse - nervous system
│   ├── digest-inject.js      # UserPromptSubmit - digest + interaction tracking
│   ├── lib/
│   │   ├── config.js         # Configuration + defaults
│   │   ├── learnings.js      # Cross-session pattern detection
│   │   ├── state.js          # Rolling action window + token estimation
│   │   ├── interactions.js   # User interaction analysis
│   │   └── retrospective.js  # Session retrospective generation
│   └── senses/
│       ├── o2.js             # Context trend
│       ├── chronos.js        # Temporal awareness
│       ├── nociception.js    # Error friction + escalation
│       ├── spatial.js        # Blast radius
│       ├── vestibular.js     # Action diversity
│       ├── echo.js           # Validation bias
│       └── drift.js          # Scope drift detection
├── assets/
│   └── icon.png              # Plugin icon
└── docs/                     # Diagrams
```

---

## Design principles

- **No news is good news** - signals only appear when values deviate from baseline
- **Trends over absolutes** - measures velocity, not absolute values
- **Invite reflection, don't command** - signals are observations the agent can act on or dismiss
- **Graceful degradation** - if the hooks fail, the agent is just normal Claude
- **Reinforcement over decay** - rules that work get stronger, not stale

## Requirements

- Node.js 18+
- Claude Code with plugin support

## Backstory

See `SPEC.md` for the full design specification and the research behind the reinforcement model.

## Licence

Apache-2.0
