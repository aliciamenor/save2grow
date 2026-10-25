# save2grow — Decisions

> Append-only: nothing here gets corrected. Four fields per decision — the format is in
> `CLAUDE.md`.
>
> It is born with no entries.

## 2026-10-25 · [001-core-loop] Runtime is Supabase Edge Functions, zero npm dependencies

**What is decided**: both HTTP entry points (`telegram-webhook`, `daily-push`) run as Supabase
Edge Functions (Deno). All Supabase and Telegram access goes through plain `fetch`-based wrappers
in `supabase/functions/_shared/`, with no `@supabase/supabase-js` and no Telegram SDK.

**Why**: the spec's delegated criterion was "fewest moving parts, given Supabase is already the
DB; prefer Edge Functions unless a concrete blocker appears" — none appeared. Adding the
Supabase JS client or a Telegram SDK would mean an npm install step inside the Edge Function
bundle for no behavior the two REST APIs don't already give directly, and a zero-dependency tree
also makes criterion 6 (no AI/LLM import) true by construction instead of needing a recurring
audit.

**What would invalidate it**: a future criterion that needs features the raw REST APIs don't
expose cleanly (e.g. Supabase Realtime, Telegram file uploads) — at that point the matching SDK
gets added for that feature only, not swapped in wholesale.

## 2026-10-25 · [001-core-loop] Daily push cron fires twice UTC and self-gates on Madrid local time

**What is decided**: `.github/workflows/daily-push.yml` schedules at both `0 6 * * *` and
`0 7 * * *` UTC, and a shell step computes `TZ=Europe/Madrid date +%H` at run time to decide
whether to actually call the `daily-push` function.

**Why**: GitHub Actions cron is UTC-only, and Europe/Madrid alternates between CET (UTC+1) and
CEST (UTC+2) with DST. A single hardcoded UTC cron would push at 07:00 or 09:00 local time for
half the year. Self-gating on the real local hour keeps the 08:00 Europe/Madrid decision correct
year-round without a second, DST-aware scheduler component.

**What would invalidate it**: moving the push off GitHub Actions cron entirely (e.g. to a
Supabase pg_cron job, which can be told a named timezone directly) would make the double-fire
gate unnecessary.
