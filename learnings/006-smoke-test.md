# 006-youtube-oembed-preview — manual smoke test (criterion 4)

Not run by the implementing agent: needs a live deploy and a real Telegram forward — same
reasoning as every prior spec's live-only criteria.

**Before starting**, redeploy the webhook — see `ARCHITECTURE.md`, "Spec 006 — Deploying":

```
supabase functions deploy telegram-webhook
```

No migration, no new secret.

## Checklist

- [ ] Forward a YouTube link she hasn't saved before (e.g. a `youtube.com/watch?v=...` or
      `youtu.be/...` link) to the bot → it replies "Guardado." as always.
- [ ] Open the feed, Pendientes tab → the card shows the video's real title and thumbnail image,
      not the plain-link fallback (no title/no image placeholder).
- [ ] Forward a second YouTube link in the `m.youtube.com/watch?v=...` form → same result: real
      title and thumbnail.
- [ ] Forward a non-YouTube link (any article) → unaffected, still resolved via the existing
      generic Open Graph fetch (spec 004), confirming the YouTube path didn't regress the
      general case.
- [ ] `supabase functions logs telegram-webhook` shows no new errors after any of the above.

Result: **not yet run** — pass/fail per step to be filled in by Alis (or the supervising session,
narrating what it observed on her behalf) after deploy.
