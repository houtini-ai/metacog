# Experiential Reinforcement Learning (ERL)

**Paper**: arxiv.org/abs/2602.13949 (Feb 2026)
**Authors**: Taiwei Shi, Sihao Chen, Bowen Jiang, Linxin Song, Longqi Yang, Jieyu Zhao
**PDF**: https://arxiv.org/pdf/2602.13949

## Core mechanism

Experience -> Reflection -> Consolidation loop embedded in RL training:

1. **First attempt**: model generates initial response
2. **Feedback**: environment provides textual feedback + reward
3. **Reflection**: model generates structured self-critique (gated - only on failures)
4. **Second attempt**: refined response guided by reflection
5. **Internalization**: successful second attempts distilled into base policy via supervised learning

## Key findings

- **+81% Sokoban, +27% FrozenLake, +11% HotpotQA** vs standard RLVR
- **Gated reflection is critical**: reflecting on successes causes reward hacking (instance-specific shortcuts that don't generalize)
- **Cross-episode memory helps but can hurt**: storing successful reflections propagates corrective knowledge, but early bad reflections can poison weaker models
- **Internalization is the killer feature**: models deploy WITHOUT needing reflection at inference time - lessons become part of base policy

## Relevance to metacognition project

- Validates that reflection on failures (not successes) drives learning
- Shows that structured self-critique is more valuable than raw experience replay
- The internalization step is what we can't do at inference time (no weight updates) - so we need external scaffolding that mimics it
- The stale reflection problem confirms our concern about Claude-Mem's approach
- Suggests metacognitive interventions should force self-generated reflection, not inject pre-digested corrections
