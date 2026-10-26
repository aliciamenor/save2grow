#!/usr/bin/env bash
# The repo's evals — one check per acceptance criterion of each spec. Run: `evals/run.sh`
set -u

passed=0
failed=0
ok() { printf 'PASS %s\n' "$1"; passed=$((passed + 1)); }
ko() { printf 'FAIL %s\n' "$1"; failed=$((failed + 1)); }
ev() { printf '     | %s\n' "$1"; }

# Each spec adds its checks here, one function per criterion, and calls them below.

# --- 001-core-loop ---------------------------------------------------------

# Criteria 1-3 (objective prompt, selection, new-objective flow) were rolled back by spec 002 —
# see specs/done/002-simplified-capture-with-images.md criterion 6. Their unit tests were removed
# with the code they covered rather than kept running against behavior that no longer exists;
# re-running them here would claim evidence for a capture flow the live handler no longer has.
# Criterion 4/5 (daily push, triage) live on, re-verified below under spec002's own eval names.

spec001_no_ai_calls() {
  # Criterion 6 — no AI/LLM SDK import anywhere in the implementation. Still true after spec 002.
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "001.6 no AI/LLM import in supabase/functions or src"
  else
    ok "001.6 no AI/LLM import in supabase/functions or src"
  fi
}

spec001_no_ai_calls

# --- 002-simplified-capture-with-images ------------------------------------

spec002_unit_tests() {
  # Criteria 1, 2, 3, 4 — unit tests under tests/ (same run as spec001_unit_tests; kept as its
  # own eval function so each spec's criteria are traceable to a named check, see
  # specs/done/002-simplified-capture-with-images.md).
  if node --test 2>&1 | tee /tmp/save2grow-002-test-output.txt | grep -q '^ℹ fail 0$'; then
    ok "002.1-4 unit tests (direct link save, photo save, overall-oldest-3 push, triage)"
  else
    ko "002.1-4 unit tests (direct link save, photo save, overall-oldest-3 push, triage)"
    ev "see /tmp/save2grow-002-test-output.txt"
  fi
}

spec002_no_ai_calls() {
  # Criterion 5 — same check as spec001_no_ai_calls, run again as its own named eval.
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "002.5 no AI/LLM import in supabase/functions or src"
  else
    ok "002.5 no AI/LLM import in supabase/functions or src"
  fi
}

spec002_objective_ui_removed() {
  # Criterion 6 — the objective-selection code path is gone from the live webhook handler.
  if grep -rE "newobj:|obj:|awaiting_objective_name" supabase/functions/_shared/webhook-handler.js supabase/functions/telegram-webhook 2>/dev/null | grep -q .; then
    ko "002.6 objective-selection code path removed from the live webhook handler"
  else
    ok "002.6 objective-selection code path removed from the live webhook handler"
  fi
}

spec002_unit_tests
spec002_no_ai_calls
spec002_objective_ui_removed

# --- 003-local-feed-with-auth ----------------------------------------------

spec003_serve_check() {
  # Criterion 1 — the local page is servable with zero extra tooling.
  if bash evals/serve-check.sh 8787 > /tmp/save2grow-003-serve-check-output.txt 2>&1; then
    ok "003.1 web/ serves index.html via python3 -m http.server, no build step"
  else
    ko "003.1 web/ serves index.html via python3 -m http.server, no build step"
    ev "see /tmp/save2grow-003-serve-check-output.txt"
  fi
}

spec003_unit_tests() {
  # Criteria 4, 5 — feed render (order, content, status per item kind) and triage (correct
  # Supabase update call + in-memory status update), against web/js/feed.js with a fake
  # Supabase client (tests/web-feed.test.js, tests/web-fakes.js). Same `node --test` run as
  # spec001/002's unit tests (no path filter — Node's test runner finds every *.test.js under
  # tests/ on its own), named here as its own eval so each criterion is traceable.
  if node --test 2>&1 | tee /tmp/save2grow-003-test-output.txt | grep -q '^ℹ fail 0$'; then
    ok "003.4-5 unit tests (feed render order/content/status, triage update + in-memory state)"
  else
    ko "003.4-5 unit tests (feed render order/content/status, triage update + in-memory state)"
    ev "see /tmp/save2grow-003-test-output.txt"
  fi
}

spec003_rls_policy() {
  # Criterion 6 (static check) — the migration gates `items`/`storage.objects` on the specific
  # allowed identity (`auth.jwt() ->> 'email'` against a dynamic setting), not
  # `auth.role() = 'authenticated'` alone, and never commits the real email as a literal.
  #
  # This is a structural check of the SQL, not a live cross-user connection: this repo has no
  # local Postgres/Docker and no live Supabase credentials available to this agent (same
  # constraint that makes criteria 2/3/8 manual-only). The live version of this exact assertion —
  # a stranger's own magic link logging in and seeing zero rows — is added to the criterion 8
  # manual smoke test checklist instead (learnings/003-smoke-test.md).
  local f
  f="$(ls supabase/migrations/0003_*.sql 2>/dev/null | head -1)"
  if [ -z "$f" ]; then
    ko "003.6 RLS policy checks the specific allowed identity, not role-only"
    ev "no supabase/migrations/0003_*.sql found"
    return
  fi
  if grep -q "enable row level security" "$f" \
    && grep -q "auth.jwt() ->> 'email'" "$f" \
    && grep -q "current_setting('app.allowed_owner_email'" "$f" \
    && ! grep -qE "'[^']*@[^']*'" "$f"; then
    ok "003.6 RLS policy checks the specific allowed identity (env-backed), not role-only, no literal email"
  else
    ko "003.6 RLS policy checks the specific allowed identity (env-backed), not role-only, no literal email"
    ev "see $f"
  fi
}

spec003_no_ai_calls() {
  # Criterion 7 — same check as spec001/002, extended to cover web/.
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions web src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "003.7 no AI/LLM import in supabase/functions, web, or src"
  else
    ok "003.7 no AI/LLM import in supabase/functions, web, or src"
  fi
}

spec003_serve_check
spec003_unit_tests
spec003_rls_policy
spec003_no_ai_calls

# --- 004-feed-ux-and-gaping-styling ----------------------------------------

spec004_unit_tests() {
  # Criteria 1 (triage-visibility, extracted to feed.js's remainsInTab), 2 (tabs/counts), 3
  # (relative time), 4 (OG fetch/parse + render), 5 (shared card shape) — same `node --test` run
  # as every other spec (no path filter — Node's test runner finds every *.test.js under tests/
  # on its own), named here as its own eval so each criterion is traceable.
  if node --test 2>&1 | tee /tmp/save2grow-004-test-output.txt | grep -q '^ℹ fail 0$'; then
    ok "004.1-4 unit tests (triage-visibility, tabs/counts, relative time, OG fetch/parse, card render)"
  else
    ko "004.1-4 unit tests (triage-visibility, tabs/counts, relative time, OG fetch/parse, card render)"
    ev "see /tmp/save2grow-004-test-output.txt"
  fi
}

spec004_preview_schema() {
  # Criterion 4 (schema eval) — migration-presence check: a migration adds the 3 nullable
  # preview columns to `items`. No local Postgres/Docker and no live Supabase credentials are
  # available to this agent (same constraint as spec003_rls_policy), so this is a static check
  # of the migration file's SQL, not a live `supabase db diff`.
  local f
  f="$(ls supabase/migrations/0005_*.sql 2>/dev/null | head -1)"
  if [ -z "$f" ]; then
    ko "004.4 migration adds preview_title/preview_description/preview_image_url to items"
    ev "no supabase/migrations/0005_*.sql found"
    return
  fi
  if grep -q "preview_title" "$f" && grep -q "preview_description" "$f" && grep -q "preview_image_url" "$f"; then
    ok "004.4 migration adds preview_title/preview_description/preview_image_url to items"
  else
    ko "004.4 migration adds preview_title/preview_description/preview_image_url to items"
    ev "see $f"
  fi
}

spec004_gaping_tokens() {
  # Criterion 6 (agent's own pre-handoff check) — the exact GAPING hex values are present in the
  # stylesheet, and no red/danger value was invented. The red check only inspects actual CSS
  # color values (a hex red, or `: red`/`red;` as a declared value), not a substring match over
  # the whole repo — "REDIRECT_URL" and "required" both contain the letters "red" harmlessly.
  local css="web/css/style.css"
  local tokens=("#f9fafb" "#ffffff" "#e5e7eb" "#1f2937" "#4b5563" "#6b7280" "#42767f" "#2f5860" "#10b981")
  local missing=""
  for t in "${tokens[@]}"; do
    grep -q -- "$t" "$css" || missing="$missing $t"
  done
  if [ -n "$missing" ]; then
    ko "004.6 GAPING hex tokens present in web/css/style.css"
    ev "missing:$missing"
    return
  fi
  if grep -nEi '#f00\b|#ff0000|:[[:space:]]*red[[:space:]]*;' "$css" | grep -q .; then
    ko "004.6 no invented red/danger color value in web/css/style.css"
    ev "see $css"
    return
  fi
  ok "004.6 GAPING hex tokens present, no invented red/danger color value"
}

spec004_triage_icons_not_text_buttons() {
  # Criterion 6 (agent's own pre-handoff check) — the spec 003 text-label triage buttons
  # ("Borrar", "Guardar como recurso", "Pendiente" as visible button text) were replaced by
  # icon-only buttons, not left duplicated. Checks that no `button.textContent` assignment in
  # app.js sets one of those 3 exact strings — the tab label ("Pendientes", plural, via
  # `tab.label`) and the icons' `aria-label`/`title` values are a different thing on purpose and
  # are not matched by this check.
  if grep -n 'textContent' web/js/app.js \
    | grep -E '"Borrar"|"Guardar como recurso"|"Pendiente"' | grep -q .; then
    ko "004.6 triage actions are icon-only buttons, not spec 003's text-label buttons"
    ev "see web/js/app.js"
  else
    ok "004.6 triage actions are icon-only buttons, not spec 003's text-label buttons"
  fi
}

spec004_no_ai_calls() {
  # Criterion 7 — same check as spec001/002/003, re-run over the files this spec adds
  # (og-preview.js, app.js, feed.js already covered by the directory-wide grep below).
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions web src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "004.7 no AI/LLM import in supabase/functions, web, or src"
  else
    ok "004.7 no AI/LLM import in supabase/functions, web, or src"
  fi
}

spec004_unit_tests
spec004_preview_schema
spec004_gaping_tokens
spec004_triage_icons_not_text_buttons
spec004_no_ai_calls

# --- 005-dedupe-links -------------------------------------------------------

spec005_unit_tests() {
  # Criteria 1, 2 — unit tests under tests/webhook-handler.test.js (exact-duplicate skips the
  # insert and names the existing item's tab; a non-matching link still saves; a duplicate never
  # triggers the OG-preview fetch). Same `node --test` run as every other spec, named as its own
  # eval so this criterion is traceable.
  if node --test 2>&1 | tee /tmp/save2grow-005-test-output.txt | grep -q '^ℹ fail 0$'; then
    ok "005.1-2 unit tests (duplicate link skips insert, reply names current tab)"
  else
    ko "005.1-2 unit tests (duplicate link skips insert, reply names current tab)"
    ev "see /tmp/save2grow-005-test-output.txt"
  fi
}

spec005_photo_path_untouched() {
  # Criterion 3 — photos are out of scope: the photo-handling branch in webhook-handler.js is
  # unchanged, and spec 002's own photo tests ("criterion 2: a photo message downloads the
  # largest size and saves it", "criterion 4: triage works the same on an image item") still pass
  # unmodified as part of the same `node --test` run checked above. This function re-asserts the
  # structural half: no `findItemByLink` call appears inside the photo branch of
  # webhook-handler.js (it's scoped to the link branch only).
  local f="supabase/functions/_shared/webhook-handler.js"
  if awk '/message\.photo\)/,/^  }/' "$f" | grep -q "findItemByLink"; then
    ko "005.3 duplicate check is not wired into the photo-handling branch"
    ev "see $f"
  else
    ok "005.3 duplicate check is not wired into the photo-handling branch (photos out of scope)"
  fi
}

spec005_no_ai_calls() {
  # Criterion 4 — same check as every prior spec, unchanged, re-run as its own named eval.
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions web src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "005.4 no AI/LLM import in supabase/functions, web, or src"
  else
    ok "005.4 no AI/LLM import in supabase/functions, web, or src"
  fi
}

spec005_unit_tests
spec005_photo_path_untouched
spec005_no_ai_calls

# --- 006-youtube-oembed-preview --------------------------------------------

spec006_unit_tests() {
  # Criteria 1, 2 — unit tests under tests/youtube-oembed.test.js (URL-pattern matching,
  # oEmbed-response mapping, non-2xx/network-error/timeout fallback) and
  # tests/webhook-handler.test.js (YouTube link routes to fetchYouTubeOembed before the generic
  # OG fetch; a non-YouTube link is untouched; a failing/throwing oEmbed call falls back to the
  # plain-link card without ever calling fetchOgPreview). Same `node --test` run as every other
  # spec, named as its own eval so these criteria are traceable.
  if node --test 2>&1 | tee /tmp/save2grow-006-test-output.txt | grep -q '^ℹ fail 0$'; then
    ok "006.1-2 unit tests (YouTube URL detection + oEmbed mapping, failure fallback)"
  else
    ko "006.1-2 unit tests (YouTube URL detection + oEmbed mapping, failure fallback)"
    ev "see /tmp/save2grow-006-test-output.txt"
  fi
}

spec006_no_ai_calls() {
  # Criterion 3 — same check as every prior spec, unchanged, re-run as its own named eval.
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions web src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "006.3 no AI/LLM import in supabase/functions, web, or src"
  else
    ok "006.3 no AI/LLM import in supabase/functions, web, or src"
  fi
}

spec006_unit_tests
spec006_no_ai_calls

printf '%s pass · %s fail\n' "$passed" "$failed"
[ "$failed" = "0" ]
