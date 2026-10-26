# 005-dedupe-links — manual smoke test (criterion 5)

Not run by the implementing agent: needs a live deploy and a real forwarded link already saved
earlier — same reasoning as every prior spec's live-only criteria.

**Before starting**, redeploy the webhook — see `ARCHITECTURE.md`, "Spec 005 — Deploying":

```
supabase functions deploy telegram-webhook
```

No migration, no new secret.

## Checklist

- [ ] Forward a link to the bot that was never saved before → it replies "Guardado." as before,
      and the item shows up in the feed's Pendientes tab.
- [ ] Forward the exact same link again, unchanged → the bot replies "Ya lo tienes guardado —
      está en Pendientes." instead of "Guardado."
- [ ] Reload the feed → no second card for that link appeared in any tab; the Pendientes count is
      unchanged from before the repeat forward.
- [ ] In the feed, move that item to Recursos (heart icon), then forward the same link a third
      time → the bot replies "Ya lo tienes guardado — está en Recursos.", naming the tab it
      actually moved to, not "Pendientes".
- [ ] Move that item to Borrados (trash icon), then forward the same link once more → the bot
      replies "Ya lo tienes guardado — está en Borrados." — a deleted item still counts as
      already saved, exactly as decided (closed decision, Gate 1, 2026-10-26).
- [ ] Forward a photo (not a link) → unaffected, saves and replies "Guardado." as always; photos
      are out of scope for this spec (criterion 3).
- [ ] `supabase functions logs telegram-webhook` shows no new errors after any of the above.

Result: **not yet run** — pass/fail per step to be filled in by Alis (or the supervising session,
narrating what it observed on her behalf) after deploy.
