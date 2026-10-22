# save2grow

The body of an initiative: the specs, the decisions and the as-built of what gets built here.
The head —what it is for and what state it is in— lives in the brain that mounted this repo.
This repo reads on its own: nothing here assumes the brain is within reach.

## Where each thing lives

| Question | Where | Lifecycle |
|---|---|---|
| How it is built | `ARCHITECTURE.md` (the as-built) | Live, overwritten |
| What is missing | `specs/` (+ `done/`) | Transient |
| What was decided and why | `decisions.md` | **Append-only**, never corrected |
| What we learned | `learnings/` | Live: updated or deleted |
| What broke, and why | `docs/postmortems/` | Dated, not overwritten |
| Research evidence | `docs/research/` | Dated, not overwritten |
| The check for each criterion | `evals/run.sh` | Live: one check per criterion |

## Gates

- **Gate 1**: no implementation starts without an approved spec.
- **Gate 2**: a person merges. Agents work on branches, never push to `main` and never merge:
  `.claude/settings.json` denies them both commands.
- The PR carries the evidence of the evals. Whoever reviews it reports nothing they cannot quote
  literally with `file:line`, and nothing without naming what breaks.

## Definition of Done

- The spec's criteria pass their evals, with the evidence recorded. Claiming with no evidence is
  not done.
- No regression on the critical path.
- No code from abandoned attempts in the diff.
- No secrets in code, docs or commits.
- `ARCHITECTURE.md` updated if it changed; new decisions in `decisions.md`; whatever serves the
  next time, in `learnings/`.
- Spec archived in `specs/done/`. Ready to ASK for the merge — never autonomous.

## How it is written

**The primary reader of these documents is an agent in another session, with nothing of the
conversation that produced them.**

1. **Each rule is stated in a single place.** The other documents reference it by path.
2. **Numbers and checks go isolated**, never embedded in a sentence.
3. **No narrative connectors**: they do not instruct and they take up context.

A decision has four fields and no more:

```
## DATE · [scope] Title that states the rule, not the topic

**What is decided**: one or two lines. The rule, with no argument.
**Why**: one paragraph. One.
**Replaces**: only if it applies, naming the previous decision.
**What would invalidate it**: the condition that would make it false.
```

File names, commands and code in English. The product's language rule is stated once, in the
constitution of the product repo that ships `.os/core` — `CLAUDE.md` at its root — and is not
repeated here.

## Gotchas

<!-- What trips you up and cannot be deduced by opening a file goes here, one line each. What an
     `ls` already answers does not. It is born empty on purpose. -->
