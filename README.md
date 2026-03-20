# @houtini/metacog

**AI coding agents are brains in vats.** They can reason about almost anything, but they can't feel their context window filling up, don't know how long they've been working, can't sense when they're going in circles, and have no peripheral vision of how their changes affect the wider codebase.

Metacog gives them a nervous system. Five proprioceptive senses. Cross-session reinforcement tracking. Two hooks. Zero dependencies.

---

## What it actually does

So, the premise here is pretty simple. AI agents have no body. They process inputs and emit outputs with zero awareness of their own operational state. They can't feel themselves running out of context. They don't know if they've been hammering the same error for fifteen minutes. They have no sense of whether they're making progress or going in circles.

Metacog doesn't make agents smarter. It gives them something to feel with.

It runs as a pair of Claude Code hooks — one fires after every tool call (the nervous system), the other fires once per session (the memory). When everything is normal, both produce zero output and cost zero tokens. When something is abnormal, a short proprioceptive signal gets injected into the agent's context. Not a command. Just awareness. The agent's own reasoning decides what to do about it.

### The five senses

| Sense | Signal | What it detects |
|-------|--------|-----------------|
| **O2** | Context trend | Token velocity spikes — the agent is consuming context unsustainably |
| **Chronos** | Temporal awareness | Time and step count since last user interaction — the agent has no internal clock |
| **Nociception** | Error friction | Repeated similar errors — the agent is stuck but hasn't recognised it |
| **Spatial** | Blast radius | File dependency count after writes — the agent is modifying a module imported by 14 other files |
| **Vestibular** | Action diversity | Repeated identical actions — the agent is going in circles without triggering errors |

### Three layers

**Layer 1: Proprioception** (always on, near-zero cost)
Calculates all five senses. Injects a signal only when values deviate from baseline. Most turns: silent.

```
[Proprioception]
Context filling rapidly - 3 large file reads in last 5 actions.
Consider summarising findings before proceeding.
```

**Layer 2: Nociception** (triggered by Layer 1 thresholds)
When error friction crosses critical thresholds, forces a cognitive shift. Escalating interventions — socratic first, then directive, then user escalation.

```
[NOCICEPTIVE INTERRUPT]
You have attempted 4 similar fixes with consecutive similar errors.
Before taking another action:
1. State the assumption you are currently operating on
2. Describe what read-only action would falsify that assumption
3. Execute that investigation before writing any more code
```

**Layer 3: Reinforcement tracking** (cross-session learning)
This is the interesting bit. When the nervous system detects a failure pattern, it records it. But here's what makes this different from a simple activity log — it also tracks when a known failure pattern *doesn't* fire.

If a rule was injected at the start of a session, and the failure it targets never appeared during that session, that's not nothing. That's evidence the rule is working. The system records a "suppression" alongside the original "detection." Both count as evidence. Both increase confidence.

Naive time-decay penalises success. If you learn "don't retry the same error" and then you stop retrying the same error, a decay-based system sees the rule going stale and eventually prunes it. Then the behaviour regresses, the rule fires again, confidence climbs, the behaviour improves, the rule decays. Seesaw.

Reinforcement tracking breaks the seesaw. Rules that successfully suppress their target failure get reinforced by their own success. Only truly dormant rules — patterns that haven't been active at all for months — decay.

---

## Get started in one minute

**Step 1: Install the hooks**

```bash
npx @houtini/metacog --install
```

This adds both hooks to your global Claude Code settings (`~/.claude/settings.json`):
- `PostToolUse` — the nervous system (fires after every tool call)
- `UserPromptSubmit` — the digest injector (fires once per session, injects learned rules)

For per-project installation:

```bash
npx @houtini/metacog --install --project
```

**Step 2: Use Claude Code normally**

That's it. Metacog runs silently. You'll only see output when something is abnormal.

### Manual installation

If you prefer to configure the hooks yourself:

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
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/metacog/src/digest-inject.js"
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

## How the reinforcement tracking works

Here's the data flow. It's worth understanding because it's the thing that makes this more than a glorified activity log.

**Session start** — the `UserPromptSubmit` hook fires. It compiles all learnings (global + project-scoped) into a digest, injects it as a system-reminder, and writes a marker file listing which pattern IDs were injected. This marker is the key — it's how the system knows which rules were "active" during the session.

**During the session** — the `PostToolUse` hook fires after every tool call. It records actions into a rolling 20-item window. Silent when normal. Signals when abnormal. No learning happens here — this is pure proprioception.

**Session end** — when the next session starts, the first tool call triggers a session ID change. Before resetting state, the system:
1. Reads the active patterns marker from the previous session
2. Runs all pattern detectors against the session state
3. For each detector that fires: emits a **detection** (the failure happened)
4. For each detector that *doesn't* fire but was in the active set: emits a **suppression** (the rule prevented the failure)
5. Persists both to the JSONL log — global and project-scoped

**Compilation** — next session's digest compilation merges detections and suppressions. Both increase total evidence. Suppressions get a slight confidence bonus (effectiveness ratio). Only rules with zero activity for 60+ days decay. Pruning happens at 120 days for low-evidence rules.

### Per-project scoping

Learnings are stored at two levels:

- **Global** (`~/.claude/metacog-learnings.jsonl`) — patterns that apply everywhere
- **Project** (`<project>/.claude/metacog-learnings.jsonl`) — patterns specific to this codebase

At digest compilation time, both are merged. Project-scoped entries take precedence where they overlap. This means a pattern that only happens in one repo builds evidence specifically for that repo, without polluting the global set.

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

| Setting | Default | What it does |
|---------|---------|-------------|
| `o2.velocity_multiplier` | 3 | Trigger when token velocity exceeds baseline by this factor |
| `chronos.time_threshold_minutes` | 15 | Signal after this many minutes without user interaction |
| `chronos.step_threshold` | 25 | Signal after this many tool calls without user interaction |
| `nociception.consecutive_errors` | 3 | Similar errors before signalling |
| `spatial.blast_radius_threshold` | 5 | File imports before signalling |
| `vestibular.consecutive_similar` | 4 | Identical actions before signalling |

---

## The backstory

This project started with a question about metacognition — thinking about thinking. Could we make AI agents reflect on their own behaviour? But the deeper we got, the more we realised the real problem isn't that agents think badly. It's that they can't feel anything.

Traditional "memory" plugins for AI agents record what the agent did — episodic memory stored in SQLite, retrieved by semantic search. This has problems. Stale data. Token tax on every retrieval. And no actual learning — replaying actions isn't reflection, it's a search engine over a diary.

The proprioception metaphor turned out to be the right one. You don't avoid walking into walls because a "Collision Detection Module" writes a report about a recent impact. You avoid walls because your nervous system provides immediate, low-latency, non-verbal feedback about your physical state.

But proprioception alone only works within a session. The agent wakes up fresh every time. So we built reinforcement tracking on top — a way for the agent to carry forward behavioural lessons across sessions, with a confidence model that actually rewards rules for working rather than punishing them for not failing.

The combination of real-time proprioception and cross-session reinforcement tracking is, as far as we can tell, novel. Most agent memory systems are either activity logs (what happened) or skill libraries (what to do). This is neither. It's a record of what goes wrong, what prevents it from going wrong, and how confident we should be in each lesson.

See `SPEC.md` for the full design specification and theoretical foundation.

---

## Design principles

- **No news is good news** — signals only appear when values deviate from baseline. The absence of a signal means everything is fine
- **Trends over absolutes** — measures velocity and trajectory, not absolute values. We can't know the exact context limit, so we track "filling rapidly" not "88% full"
- **Inform, don't command** — provides awareness, trusts the agent's reasoning. Only at extreme thresholds does the system force a cognitive shift
- **Graceful degradation** — if the hooks fail, the agent is just normal Claude. Nothing breaks
- **Reinforcement over decay** — rules that work get stronger, not stale

## Requirements

- Node.js 18+
- Claude Code with hooks support

## Licence

Apache-2.0
