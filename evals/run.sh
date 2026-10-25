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

spec001_unit_tests() {
  # Criteria 1, 2, 3, 4, 5 — unit tests under tests/, see specs/done/001-core-loop.md.
  if node --test 2>&1 | tee /tmp/save2grow-001-test-output.txt | grep -q '^ℹ fail 0$'; then
    ok "001.1-5 unit tests (capture, selection, new objective, daily push, triage)"
  else
    ko "001.1-5 unit tests (capture, selection, new objective, daily push, triage)"
    ev "see /tmp/save2grow-001-test-output.txt"
  fi
}

spec001_no_ai_calls() {
  # Criterion 6 — no AI/LLM SDK import anywhere in the implementation.
  if grep -rE "anthropic|openai|@anthropic-ai" supabase/functions src 2>/dev/null | grep -v '^Binary' | grep -q .; then
    ko "001.6 no AI/LLM import in supabase/functions or src"
  else
    ok "001.6 no AI/LLM import in supabase/functions or src"
  fi
}

spec001_unit_tests
spec001_no_ai_calls

printf '%s pass · %s fail\n' "$passed" "$failed"
[ "$failed" = "0" ]
