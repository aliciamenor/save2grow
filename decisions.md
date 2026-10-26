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

## 2026-10-25 · [001-core-loop] Owner whitelist enforced via OWNER_TELEGRAM_ID env var

**What is decided**: `telegram-webhook/index.ts` reads `OWNER_TELEGRAM_ID` from the environment
and silently ignores (returns `200 ok`, no processing) any update whose sender id doesn't match
it. Every sender id is still logged regardless of the match, filter active or not.

**Why**: the spec's stopping condition was honored as written — ship logging-only, ask Alis to
confirm her id, enforce in a fast-follow. She confirmed it the same day. The id isn't
password-grade sensitive, but it's a fixed identifier tied to her real account in a public repo's
permanent history, so it lives only as the `OWNER_TELEGRAM_ID` secret — never written in a commit,
even as config.

**What would invalidate it**: a second real user (Fase 1) turns this from "one owner id" into
"a list of allowed ids" — at that point this single-value env var becomes a table lookup, not a
bigger env var.

## 2026-10-25 · [001-core-loop] telegram-webhook deployed with verify_jwt = false

**What is decided**: `supabase/config.toml` sets `verify_jwt = false` for the `telegram-webhook`
function only. `daily-push` keeps the default (JWT required).

**Why**: Telegram's servers call the webhook directly with no Supabase auth header at all —
Supabase's default JWT verification silently rejected every incoming update before the code ran,
so the bot never replied and nothing was logged as an error. `daily-push` is only ever called by
our own GitHub Actions workflow using the service-role key, which already is a valid JWT, so it
keeps the safer default.

**What would invalidate it**: moving webhook verification to a shared secret in the URL path or a
Telegram-specific signature check (Telegram doesn't sign webhook payloads today) instead of
relying on `verify_jwt = false` wide open to any caller.

## 2026-10-26 · [002-simplified-capture] `objective_id`, `objectives`, `captures`, `pending_actions` dropped, not left unused

**What is decided**: `supabase/migrations/0002_simplified_capture.sql` drops the `objective_id`
column from `items`, and drops the `objectives`, `captures`, and `pending_actions` tables
outright, rather than leaving them nullable/unused. `items.link` becomes nullable and
`items.image_path` is added, with a check constraint requiring at least one of the two.

**Why**: the spec's delegated criterion was "whichever makes Fase 1's eventual migration cleanest
to write and leaves the live schema honest". A nullable, never-set `objective_id` or an
unreferenced `pending_actions` table would look live without being written to by anything in
this scope — exactly what criterion 6 rules out. Dropping them means Fase 1 writes one clean
migration (`create table objectives…`, `alter table items add column objective_id…`) against a
schema that has no half-wired leftovers to reconcile with, instead of untangling a column that
spent a release silently unused. `captures` existed only to stage a link between the removed
prompt and the removed selection step; with direct save there is no staging step left, so it goes
too, even though the spec's text names only `objective_id`/`objectives`/`pending_actions`
explicitly.

**What would invalidate it**: if Fase 1's objective-selection UI turns out to need to recover any
data that lived only in these tables (none is expected — they held in-flight staging state, never
historical record) the migration history (`0001_init.sql`) still has the original shape for
reference.

## 2026-10-26 · [002-simplified-capture] Captured images live in a private Supabase Storage bucket, read only via signed URL

**What is decided**: `supabase/migrations/0002_simplified_capture.sql` creates the
`item-images` bucket with `public = false`. `_shared/db.js#uploadImage` writes to it with the
service-role key; `_shared/db.js#getSignedUrl` is the only way anything in this codebase reads an
image back, and the daily push uses it to hand Telegram a usable URL (`_shared/push-handler.js`).

**Why**: the spec's delegated criterion was to default to the least exposure, since this repo is
public and spec 003 is what adds the first real auth — a public bucket would mean anyone who
guessed or scraped a storage path could read Alis's captured photos with no gate at all, for
however long the gap before spec 003 lasts.

**What would invalidate it**: spec 003 landing real auth in front of a browsing UI that needs to
render many images at once — at that point, signed URLs with a short expiry might be replaced by
a thin authenticated proxy route, but the bucket itself should stay private either way.

## 2026-10-26 · [002-simplified-capture] Confirmation reply is a single plain "Guardado.", no system jargon

**What is decided**: both a saved link and a saved photo get the exact same reply text,
`"Guardado."`, with no inline keyboard and no mention of "objetivo", "captura", "item" or any
other internal name.

**Why**: the spec's delegated criterion ruled out internal vocabulary leaking into what the bot
says back to Alis. A single fixed string for both capture kinds also keeps the confirmation from
silently drifting into two different voices as photo support was added alongside links.

**What would invalidate it**: Fase 1 reintroducing a reason to distinguish the two in the reply
(e.g. "Guardado como imagen." if an operator needs to tell at a glance which kind was saved
without opening Supabase) — nothing in this spec's scope needs that distinction yet.

## 2026-10-26 · [003-local-feed-with-auth] RLS checks the allowed email via a Postgres session setting, never a literal

**What is decided**: `supabase/migrations/0003_local_feed_auth.sql` enables RLS on `items` and
adds a `select`/`update` policy on `items`, and a `select` policy on `storage.objects` for the
`item-images` bucket, all with the same predicate: `auth.jwt() ->> 'email' =
current_setting('app.allowed_owner_email', true)`. The real email is never written into this
repo; it's set once per database with `alter database postgres set app.allowed_owner_email =
'<value>'`, run outside this repo from the `ALLOWED_OWNER_EMAIL` secret.

**Why**: the spec's stopping condition ruled out committing the allowed email as a literal
anywhere, the same rule already applied to `OWNER_TELEGRAM_ID` (see the 2026-10-25 entry above).
RLS policies can't read an environment variable directly — they run inside Postgres, not inside
an Edge Function's runtime — so a Postgres-level setting is the equivalent of an env var for this
layer: a value supplied once, outside the committed SQL, that the policy reads at query time
instead of hardcoding.

**What would invalidate it**: a second real user (mirroring the note on `OWNER_TELEGRAM_ID`) turns
this from "one allowed email" into "a table of allowed identities" — at that point the single
session setting becomes a lookup table, not a bigger setting.

## 2026-10-26 · [003-local-feed-with-auth] RLS checks the specific identity, not role-only

**What is decided**: every policy in `0003_local_feed_auth.sql` compares `auth.jwt() ->> 'email'`
against the one allowed value — never just `auth.role() = 'authenticated'` on its own.

**Why**: this repo is public and magic-link signup is open to anyone who requests a link for
their own email. Role-only RLS would let a stranger log in as themselves and still read or write
Alis's rows, because they'd legitimately hold the `authenticated` role. Checking the specific
email is what makes "a stranger logs in successfully" and "a stranger sees Alis's data" two
different, unrelated things.

**What would invalidate it**: a second real user (Fase 1, same condition as the two entries
above) — at that point the policy's comparison becomes "is this email in the allowed set", not
"does it equal the one value".

## 2026-10-26 · [003-local-feed-with-auth] Web feed's frontend logic is split pure-logic vs. DOM wiring, same shape as the Edge Functions

**What is decided**: `web/js/feed.js` holds every function that talks to Supabase or decides what
to render (`fetchFeed`, `triageItem`, `applyTriageResult`) with zero DOM access, so it runs and is
unit tested under Node with a fake Supabase client (`tests/web-fakes.js`,
`tests/web-feed.test.js`). `web/js/app.js` holds only DOM reads/writes and event wiring, calling
into `feed.js` for everything else, and is not unit tested.

**Why**: this repo already draws this exact line for the Telegram bot —
`supabase/functions/_shared/*.js` is tested, `index.ts`'s env/HTTP wiring isn't — specifically so
business logic can be verified without live credentials or a running runtime (Deno there, a
browser DOM here). Reusing the same split means criteria 4 and 5's evals (render order/content/
status, triage's update call and in-memory state change) are fully scriptable without a headless
browser or any new dependency (e.g. jsdom), keeping the zero-npm-dependency property intact for
the frontend too.

**What would invalidate it**: a future criterion that genuinely needs DOM behavior under test
(e.g. keyboard navigation, focus management) — at that point a headless-DOM dependency gets added
for that feature only, not as a blanket tooling change.

## 2026-10-26 · [003-local-feed-with-auth] Allowed owner email lives in a table, not a Postgres GUC

**What is decided**: `supabase/migrations/0004_app_config_table.sql` adds `app_config(key,
value)`, RLS-enabled, readable by any authenticated user. The RLS policies on `items` and
`storage.objects` now compare against `(select value from app_config where key =
'allowed_owner_email')` instead of `current_setting('app.allowed_owner_email', true)`.

**Why**: spec 003's original design (session GUC set via `alter database ... set`) failed at
deploy — Supabase's managed Postgres returns "permission denied to set parameter" for that
statement even on the linked project's own connection; it isn't a superuser role. A config table
needs no elevated privilege, only an ordinary `insert`. Making the table world-readable to
authenticated users is not a new exposure: its one row is the exact email every other policy
already compares against, so a stranger reading it back learns nothing they couldn't already
infer from being denied by every other policy.

**Replaces**: the GUC-based design described in spec 003's own migration file and
`ARCHITECTURE.md` as originally written (2026-10-26, same day, before this correction).

**What would invalidate it**: moving to Supabase Vault for this value once this product holds
more than one piece of app-wide config worth centralizing — a single-row table is the "boring and
proven" choice at n=1, not necessarily at n=10.

## 2026-10-26 · [004-feed-ux-and-gaping-styling] Triage never deletes — 3 tabs, each triage icon just moves an item between them

**What is decided**: `items.status` ∈ {`pending`, `resource`, `deleted`} now maps 1:1 to 3 feed
tabs (Pendientes / Recursos / Borrados). Every item in every tab keeps the same 3 triage icons;
tapping any of them is the same `triageItem` call regardless of which tab the item started in,
including restoring an item from Borrados via the "Pendiente" icon.

**Why**: the live bug this spec fixes was exactly this gap — "Borrar" wrote `status='deleted'`
correctly but the UI gave no visible sign anything happened, since spec 003's single list kept
showing every status in place. Making Borrados a real, reversible tab (closed by Alis at Gate 1)
means the fix and the UX rework are the same change: moving tabs *is* the visible feedback, and
"undo" needs no separate feature because it's the same triage action from a different starting
tab.

**What would invalidate it**: a future request for actual, permanent deletion (out of scope,
named explicitly in the spec) — at that point a 4th status or a real `delete` would need its own
irreversible-action confirmation, on top of this reversible triage.

## 2026-10-26 · [004-feed-ux-and-gaping-styling] Open Graph previews: plain regex over `<meta>` tags, no HTML-parsing dependency

**What is decided**: `supabase/functions/_shared/og-preview.js#parseOgTags` matches
`<meta property="og:title|og:description|og:image" content="…">` (either attribute order) with
regular expressions, not an HTML parsing library. `fetchOgPreview` wraps the fetch in a
4000ms (`OG_FETCH_TIMEOUT_MS`) `AbortController` timeout and resolves `null` — never throws — on
any failure: non-2xx, network error, timeout, or no matching tags.

**Why**: the spec's delegated criterion was zero npm dependencies if reasonably achievable,
matching this repo's established pattern (see the 2026-10-25 runtime decision above). OG tags are
a fixed, simple `<meta>` shape; a regex that accepts both attribute orders is reliable enough for
that one shape without pulling in a general HTML parser, which nothing else in this repo needs
either. 4 seconds was picked as "a few seconds at most" per the spec's own criterion: long enough
that a normal page's TTFB doesn't trip it, short enough that Alis's "Guardado." reply is never
meaningfully delayed by a link preview most of the time she'll never watch load.

**What would invalidate it**: a site whose OG tags are injected by client-side JavaScript (so the
raw HTML this fetcher sees never contains them) — at that point either falling back to the plain
link stays correct behavior (nothing here promises every page gets a preview) or, if that becomes
unacceptably common, a headless-render dependency would need its own spec, not a silent addition
here.

## 2026-10-26 · [004-feed-ux-and-gaping-styling] "hoy"/"hace N …" buckets by elapsed duration, not calendar-day boundaries

**What is decided**: `web/js/feed.js#relativeTime(createdAt, now)` buckets strictly by elapsed
milliseconds since `created_at`, in this order: under 1 minute → `"hoy"`; under 60 minutes →
`"hace N minutos"`; under 24 hours → `"hace N horas"`; under 7 days → `"hace N días"`; otherwise
→ `"hace N semanas"`. It does not look at calendar-day boundaries (e.g. "earlier today" vs.
"yesterday" at local midnight).

**Why**: the spec gave 3 example output strings (`"hace 2 días"`, `"hace 3 horas"`, `"hoy"`) but
left the exact bucketing mechanism unstated. A pure duration-based scheme is the simplest
internally-consistent reading that reproduces all 3 examples without adding timezone/calendar-day
logic nothing else in this spec needs, and it's trivially unit-testable with a fixed `now` and
fixture timestamps (the eval's own requirement).

**What would invalidate it**: a future request that specifically wants calendar-relative language
("ayer" for yesterday, independent of how many hours ago that was) — that's a genuinely different
semantic (local calendar date vs. elapsed duration) and would replace this function, not extend
it.
