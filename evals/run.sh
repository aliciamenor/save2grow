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

printf '%s pass · %s fail\n' "$passed" "$failed"
[ "$failed" = "0" ]
