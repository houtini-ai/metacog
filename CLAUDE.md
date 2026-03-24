# Metacog

Claude Code hook plugin that gives the agent real-time awareness of its own cognitive state.

## Architecture

Two hooks, one state file:

- **`src/hook.js`** (PostToolUse) - fires after every tool call, evaluates 7 senses, outputs a signal only when something is abnormal. Silent exit 0 = everything fine. JSON stdout = signal for the agent.
- **`src/digest-inject.js`** (UserPromptSubmit) - fires on every user message. First message of session: injects behavioural digest + session retrospective. Every message: captures task fingerprint for drift detection, records user interaction metadata.
- **`.claude/metacog.state.json`** - ephemeral rolling window of last 20 actions. Written by hook.js, read by both hooks. Reset on session change. Do not persist or version control this file.

## The 7 senses (src/senses/)

| Sense | File | What it watches |
|-------|------|-----------------|
| O2 | o2.js | Token velocity vs baseline |
| Chronos | chronos.js | Time and steps since last user interaction |
| Nociception | nociception.js | Consecutive similar errors (Layer 1 + Layer 2 escalation) |
| Spatial | spatial.js | git grep for importers after writes |
| Vestibular | vestibular.js | Repeated identical actions |
| Echo | echo.js | Write streaks without test runs, self-test pattern |
| Drift | drift.js | Recent actions diverging from task fingerprint |

## Key principles when modifying senses

- **Silent by default.** A sense that fires too often is worse than one that never fires. No news is good news.
- **Every sense has a cooldown.** After firing, suppress for N turns. One nudge is enough.
- **Graceful degradation.** Any error in any sense must be caught. If the hook crashes, the agent loses proprioception but keeps working. Never let the nervous system kill the brain.
- **Inform, don't command.** Layer 1 signals are observations the agent can dismiss. Only Layer 2 (nociception escalation) forces structured reflection, and it earns that right by requiring repeated failure first.
- **Subagent awareness.** Agent tool calls are delegations, not grinding. Suppress O2 and Chronos on delegation returns.
- **Cooldown ticking.** If you add a new cooldown field to state, you must also tick it down in `state.js:appendAction()`.

## Cross-session learning (src/lib/)

- **learnings.js** - pattern detectors, JSONL persistence, confidence model with reinforcement (suppressions count as evidence)
- **interactions.js** - user prompt analysis (specificity scoring), interaction recording
- **retrospective.js** - generates prior session summary at session start
- **state.js** - rolling action window, token estimation, session boundary detection, cooldown ticking
- **config.js** - defaults with deep-merge user overrides from `.claude/metacog.config.json`

## Config

All config in `src/lib/config.js` DEFAULTS object. Users override via `.claude/metacog.config.json` in their project. When adding a new configurable threshold, add the default there and document it in README.md.

## Testing

```bash
node --test src/__tests__/*.test.js
```

Two test files: `senses.test.js` (original 37 tests) and `new-features.test.js` (27 tests for drift, interactions, retrospective).

## Publishing

Package is `@houtini/metacog` on npm. GitHub repo is `houtini-ai/metacog`.

1. Bump version in `package.json`
2. Commit and push
3. `npm publish` (manual, not automated)

The `npx @houtini/metacog --install` command registers hooks pointing at the npm cache copy. `node src/install.js --install` points hooks at the local checkout.

## Writing style

README is written in the project owner's natural voice (long sentences, "So," and "But" transitions, no em dashes, no marketing speak). See `C:\dev\content-machine\templates\writing-style-from-corpus.md` for the full style guide.
