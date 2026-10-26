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

printf '%s pass · %s fail\n' "$passed" "$failed"
[ "$failed" = "0" ]
