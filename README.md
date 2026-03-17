# @houtini/metacog

[![npm version](https://img.shields.io/npm/v/@houtini/metacog.svg?style=flat-square)](https://www.npmjs.com/package/@houtini/metacog)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue?style=flat-square)](https://registry.modelcontextprotocol.io)
[![Known Vulnerabilities](https://snyk.io/test/github/houtini-ai/metacog/badge.svg)](https://snyk.io/test/github/houtini-ai/metacog)

**AI coding agents are brains in vats.** They can reason about almost anything, but they can't feel their context window filling up, don't know how long they've been working, can't sense when they're going in circles, and have no peripheral vision of how their changes affect the wider codebase.

Metacog gives them a nervous system. Five proprioceptive senses. One PostToolUse hook. Zero dependencies.

---

## What it does

Metacog is a Claude Code hook that runs silently after every tool call, calculating five operational state signals. When everything is normal, it produces zero output and costs zero tokens. When something is abnormal, it injects a short proprioceptive signal into the agent's context -- not a command, just awareness.

The agent's own reasoning decides what to do about it.

### The five senses

| Sense | Signal | What it detects |
|-------|--------|-----------------|
| **O2** | Context trend | Token velocity spikes -- the agent is consuming context unsustainably (large file reads, verbose output) |
| **Chronos** | Temporal awareness | Time and step count since last user interaction -- the agent has no internal clock |
| **Nociception** | Error friction | Repeated similar errors -- the agent is stuck but hasn't recognised it |
| **Spatial** | Blast radius | File dependency count after writes -- the agent is modifying a module imported by 14 other files |
| **Vestibular** | Action diversity | Repeated identical actions -- the agent is going in circles without triggering errors |

### Three layers

**Layer 1: Proprioception** (always on, near-zero cost)
Calculates all five senses. Injects a signal only when values deviate from baseline. Most turns: silent. No wallpaper, no alert fatigue.

```
[Proprioception]
Context filling rapidly - 3 large file reads in last 5 actions. Consider summarising findings before proceeding.
```

**Layer 2: Nociception** (triggered by Layer 1 thresholds)
When error friction crosses critical thresholds, forces a cognitive shift. Escalating interventions:
1. Socratic: "State your assumption and what read-only action would test it"
2. Directive: "Read the documentation before proceeding"
3. User escalation: "I appear to be stuck -- should we reassess?"

```
[NOCICEPTIVE INTERRUPT]
You have attempted 4 similar fixes with consecutive similar errors.
Before taking another action:
1. State the assumption you are currently operating on
2. Describe what read-only action would falsify that assumption
3. Execute that investigation before writing any more code
```

**Layer 3: Motor learning** (future -- triggered by Layer 2 resolution)
When a failure loop resolves, extract a durable correction rule capturing the delta between assumption and reality. Not an activity log -- a lesson.

---

## Get started in one minute

**Step 1: Install the hook**

```bash
npx @houtini/metacog --install
```

This adds a PostToolUse hook to your global Claude Code settings (`~/.claude/settings.json`).

For per-project installation:

```bash
npx @houtini/metacog --install --project
```

**Step 2: Use Claude Code normally**

That's it. Metacog runs silently. You'll only see output when something is abnormal.

### Manual installation

If you prefer to configure the hook yourself, add this to your Claude Code settings:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/metacog/src/hook.js"
          }
        ]
      }
    ]
  }
}
```

### Local build

```bash
git clone https://github.com/houtini-ai/metacog
cd metacog
npm test
```

Zero dependencies. Nothing to build. The source is the distribution.

---

## How it works

Every tool call, the PostToolUse hook:

1. Reads JSON from stdin (tool name, input, result, session ID)
2. Appends an action record to a rolling 20-item window (`.claude/metacog.state.json`)
3. Evaluates all five senses against the current window
4. If all normal: exits with code 0 (silent, zero tokens)
5. If abnormal: exits with code 2, writes signal to stderr (injected into Claude's context)

The state file is ephemeral -- it only holds the current session's rolling window. No database, no persistence beyond the session.

### Design principles

- **No news is good news** -- signals only appear when values deviate from baseline
- **Trends over absolutes** -- measures velocity and trajectory, not absolute values (we can't know the exact context limit)
- **Inform, don't command** -- provides awareness, trusts the agent's reasoning
- **Graceful degradation** -- any error in the hook exits 0 silently; the agent is just normal Claude

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
    }
  },
  "nociception": {
    "escalation_cooldown": 5,
    "reflex_arc_threshold": 8
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `o2.velocity_multiplier` | 3 | Trigger when token velocity exceeds baseline by this factor |
| `o2.baseline_window` | 10 | Turns to establish baseline velocity |
| `chronos.time_threshold_minutes` | 15 | Signal after this many minutes without user interaction |
| `chronos.step_threshold` | 25 | Signal after this many tool calls without user interaction |
| `nociception.consecutive_errors` | 3 | Similar errors before signalling |
| `nociception.error_similarity` | 0.6 | Jaccard similarity threshold for "same error" |
| `spatial.blast_radius_threshold` | 5 | File imports before signalling |
| `vestibular.consecutive_similar` | 4 | Identical actions before signalling |
| `nociception.escalation_cooldown` | 5 | Turns of silence after a nociceptive interrupt |

---

## The backstory

This project started with a question: "What if AI agents had metacognition?" It evolved into something different and more fundamental.

Traditional "memory" plugins for AI agents (like Claude-Mem) record what the agent *did* -- episodic memory stored in SQLite, retrieved by semantic search. This has problems: stale data, token tax on retrieval, and no actual learning.

Metacognition (thinking about thinking) seemed like a better approach. But further analysis revealed the real problem isn't that agents think badly -- it's that they **can't feel anything**. They're missing the proprioceptive senses that biological intelligence takes for granted:

- No sense of how full their context window is
- No internal clock
- No awareness of error patterns
- No peripheral vision of code dependencies
- No sense of whether they're making progress or going in circles

Metacog doesn't make agents smarter. It gives them a body they can feel.

See `SPEC.md` for the full design specification and theoretical foundation.

---

## Requirements

- Node.js 18+
- Claude Code with hooks support

## Licence

MIT
