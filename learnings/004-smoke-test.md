# 004-feed-ux-and-gaping-styling — manual smoke test (criterion 8, plus the visual rubric in criterion 6)

Not run by the implementing agent: needs a live deploy (migration pushed, webhook redeployed,
local server restarted to pick up the new JS/CSS) and a real forwarded link for the Open Graph
preview — same reasoning as every prior spec's live-only criteria.

**Before starting**, three things must already be true — see `ARCHITECTURE.md`, "Spec 004 —
Deploying":

1. `supabase db push` has applied `supabase/migrations/0005_link_previews.sql`.
2. `supabase functions deploy telegram-webhook` has picked up the OG-preview wiring
   (`_shared/og-preview.js`, `_shared/webhook-handler.js`, `telegram-webhook/index.ts`).
3. The local server has been restarted (`cd web && python3 -m http.server 8787`) so the browser
   loads the new `index.html`/`app.js`/`feed.js`/`style.css`, not a cached spec 003 version —
   hard-refresh (cmd/ctrl+shift+R) if the browser was already open on the old page.

## Checklist

**Triage moves between tabs (criterion 1, the bug fix) — the main thing to verify:**

- [ ] Open `http://localhost:8787/`, log in → feed shows 3 tabs: "Pendientes (N)", "Recursos",
      "Borrados", with Pendientes active by default and its count matching what's actually shown.
- [ ] On an item in Pendientes, tap the trash icon ("Borrar") → the card disappears from
      Pendientes immediately, no page reload, and the Pendientes count drops by 1.
- [ ] Switch to the Borrados tab → the item just removed from Pendientes is there.
- [ ] On that same item in Borrados, tap the clock icon ("Pendiente") → it disappears from
      Borrados and reappears back in the Pendientes tab (same item, same content) — this is the
      restore case, the same code path as any other triage action, not a separate feature.
- [ ] On an item in Pendientes, tap the heart icon ("Guardar como recurso") → it disappears from
      Pendientes and appears in Recursos.
- [ ] Confirm in Supabase (`items` table) that each of the above actually changed `status` in the
      database, not just the on-screen tab — the fix is that the UI now visibly matches what the
      database already did correctly since spec 003.

**Card layout and GAPING visual rubric (criterion 6):**

- [ ] The feed reads as a single column of full-width cards (not a list, not a grid).
- [ ] Each card's image/preview fills the top of the card edge-to-edge, with the title (if any),
      description/link, and "hace X" timestamp below it in small muted text, and a row of 3
      icon-only buttons (no text labels) at the bottom.
- [ ] The page background is off-white (not pure white), cards are white with a visible soft
      shadow and rounded corners.
- [ ] The page title ("save2grow") uses the display font (Space Grotesk — distinct, geometric);
      body text uses Inter.
- [ ] Nothing on the page is red, including the trash/"Borrar" icon — it should look the same
      neutral grey weight as the clock icon until hovered.
- [ ] The heart/"Guardar como recurso" icon is green; the clock/"Pendiente" icon is teal.

**Link previews (criterion 4):**

- [ ] Forward a new link with known Open Graph tags (e.g. a real news article) to the Telegram
      bot → it replies "Guardado." as before.
- [ ] Reload the feed (or wait for the next `loadFeed`) → that item's card shows the fetched
      preview image, title, and description instead of a bare URL.
- [ ] Forward a link to a page with no Open Graph tags (or a URL that 404s) → it still saves and
      replies "Guardado.", and its card in the feed falls back to the plain clickable link, not a
      broken image or an error.

**Regressions to rule out:**

- [ ] The Telegram bot's own triage buttons (from spec 001/002, inline keyboard under the daily
      push) still work unaffected — this spec only touched the web feed's display and the
      preview fetch, not `_shared/push-handler.js`.
- [ ] `supabase functions logs telegram-webhook` shows no new errors after a normal link/photo
      capture.

Result: **not yet run** — pass/fail per step to be filled in by Alis (or the supervising session,
narrating what it observed on her behalf) after deploy.
