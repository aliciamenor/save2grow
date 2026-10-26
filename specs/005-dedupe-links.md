---
status: pendiente
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
