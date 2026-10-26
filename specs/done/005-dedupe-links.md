---
status: implementada
depends_on: []
---

# 005 — Don't save a link twice

Forwarding a link that's already saved (in any tab — pending, resource, or even borrados) no
longer creates a second row. The bot tells Alis it's already there instead of silently
duplicating it.

**Type**: feature · **Flow**: requirements-first

## Prior state

`main` at `e6ac3d4` (spec 004 merged and deployed: tabs, link previews, GAPING styling). Every
forwarded link currently creates a new `items` row unconditionally, even if the exact same URL
was already captured.

## Acceptance criteria

1. **Forwarding a link that exactly matches an existing item's `link` (any status) does not
   insert a new row.** Comparison is on the trimmed URL string, case-sensitive (URLs are
   case-sensitive by spec for the path/query; normalizing further — stripping tracking
   parameters, trailing slashes — is explicitly out of scope, see below).
   - Eval: unit test — mock an existing item with a given link, then a capture of the identical
     link → asserts no `insertItem`/`insertCapture`-then-insert call happens.
2. **The bot replies differently for a duplicate**, naming where it already is (e.g. "Ya lo
   tienes guardado — está en Pendientes." / "... en Recursos." / "... en Borrados."), instead of
   the normal "Guardado." confirmation.
   - Eval: unit test — mock the same duplicate scenario → asserts the reply text names the
     existing item's actual current status/tab, not a generic message.
3. **Photos are not covered by this spec** — only link captures. Detecting a duplicate image
   reliably needs comparing file bytes/hashes, a different problem; out of scope below.
   - Eval: covered implicitly — the photo-handling code path is untouched, existing spec 002
     photo tests still pass unmodified.
4. **No AI calls anywhere in this scope** (unchanged hard constraint).
   - Eval: existing grep check, unchanged.
5. **Manual smoke test**: Alis forwards a link she already saved earlier and confirms she gets
   the "ya lo tienes" reply instead of a second save; confirms in the feed that no duplicate card
   appeared.
   - Checklist in `learnings/005-smoke-test.md`.

## Decisions

**Closed before delegating:**
- DECIDED by Alis (Gate 1, 2026-10-26): duplicate check applies regardless of the existing item's
  status — an item already in Borrados still counts as "already saved", it doesn't get
  re-captured as a fresh pending item.

**Delegated to the implementing agent, with criterion:**
- Exact query mechanism for the duplicate check (a `select` before insert vs. a unique
  constraint + catching the conflict) — criterion: whichever is simplest given the existing
  `_shared/db.js` patterns, no new dependency.

**Stopping conditions:**
- None anticipated — this is a small, fully-specified change. If the agent finds a case not
  covered here (e.g. what the daily push should do with an item that was "duplicate-blocked" —
  there is nothing to push, since nothing new was created), it proceeds on the obvious reading
  rather than stopping, since the spec's intent is unambiguous: no new row, informative reply,
  nothing else changes.

## Effects that escape the system

None beyond the existing Telegram reply during the manual smoke test (criterion 5) — same
exposure as every other spec in this product.

## Out of scope, with reactivation condition

- URL normalization (stripping `utm_*`/tracking params, trailing slashes, `http` vs `https`,
  `www.` prefix) → only if Alis finds herself hitting false "not a duplicate" cases from
  cosmetically-different URLs that are really the same page.
- Duplicate detection for photos → only if this becomes a real nuisance; needs image hashing, a
  meaningfully bigger piece of work than this spec.

## Evidence (filled in by the implementing agent, 2026-10-26)

All automated evals pass — `evals/run.sh` output below (`node --test` → 59 tests, 0 failures):

```
PASS 005.1-2 unit tests (duplicate link skips insert, reply names current tab)
PASS 005.3 duplicate check is not wired into the photo-handling branch (photos out of scope)
PASS 005.4 no AI/LLM import in supabase/functions, web, or src
16 pass · 0 fail  (all specs 001-005 combined)
```

Per criterion:

1. **No new row on an exact duplicate.** `supabase/functions/_shared/db.js#findItemByLink`
   (`select` before insert, delegated decision — see `decisions.md`, 2026-10-26) called from
   `webhook-handler.js`'s link branch before `insertItem`; on a hit, `insertItem` is never
   called. Unit tested: `tests/webhook-handler.test.js`, "spec005 criterion 1: an exact duplicate
   link does not insert a new row" — asserts `calls.insertItem.length === 0`. Matches regardless
   of the existing item's status (no `status` filter in the query), per the closed decision.
2. **Reply names the existing item's actual tab.** `TAB_LABEL_BY_STATUS` +
   `duplicateReplyText` in `webhook-handler.js`. Unit tested across all 3 statuses: "spec005
   criterion 2: the duplicate reply names the item's actual current status/tab" — pending →
   "Pendientes", resource → "Recursos", deleted → "Borrados". A non-matching link still gets the
   normal "Guardado." (own test, no false positive).
3. **Photos untouched.** `findItemByLink` is called only inside the link branch of
   `handleMessage`, never the photo branch — structural check `spec005_photo_path_untouched` in
   `evals/run.sh`. Spec 002's existing photo tests ("criterion 2: a photo message downloads the
   largest size and saves it", "criterion 4: triage works the same on an image item") pass
   unmodified in the same `node --test` run.
4. **No AI calls.** `spec005_no_ai_calls`, same grep as every prior spec.
5. **Manual smoke test.** Not run by this agent — needs a live deploy (webhook redeployed) and a
   real forwarded link already saved earlier. Checklist: `learnings/005-smoke-test.md`, status
   **not yet run**.

**Open after this agent's work**: criterion 5's live checklist in `learnings/005-smoke-test.md`.
Branch: `worktree-agent-a0dd19a3de400b17b`, ready for Gate 2 (`scripts/merge-if-green.sh`).
