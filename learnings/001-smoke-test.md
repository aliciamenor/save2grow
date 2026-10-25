# 001-core-loop — manual smoke test (criterion 7)

Not run by the implementing agent: needs a live bot token and Alis's own Telegram account
(spec 001, criterion 7 — "not scriptable without a live bot token in CI"). Fill in after deploy.

Also open: Alis's Telegram numeric user ID is not confirmed yet, so the owner whitelist is
**not enforced** — every incoming sender id is only logged (see ARCHITECTURE.md, "Owner
whitelist"). Confirm the id, then turn the filter on in a fast-follow commit.

## Checklist

- [ ] Forward a real link to the live bot → reply shows one button per existing objective +
      "+ nuevo objetivo".
- [ ] Tap an existing objective → row appears in Supabase `items` with the right link,
      objective_id, status=`pending`.
- [ ] Tap "+ nuevo objetivo", send a name → new row in `objectives`, item attached to it.
- [ ] Wait for (or trigger) the next day's push at 08:00 Europe/Madrid → message arrives with the
      3 triage buttons.
- [ ] Tap each of the 3 triage buttons on different items → status updates in Supabase
      accordingly (deleted / resource / stays pending), nothing blocks sending a new link
      afterwards.
- [ ] Confirm the numeric sender id appears in `supabase functions logs telegram-webhook`.

Result: **not yet run** — pass/fail per step to be filled in by Alis after deploy.
