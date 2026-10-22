#!/usr/bin/env bash
# The repo's evals — one check per acceptance criterion of each spec. Run: `evals/run.sh`
set -u

passed=0
failed=0
ok() { printf 'PASS %s\n' "$1"; passed=$((passed + 1)); }
ko() { printf 'FAIL %s\n' "$1"; failed=$((failed + 1)); }
ev() { printf '     | %s\n' "$1"; }

# Each spec adds its checks here, one function per criterion, and calls them below.

printf '%s pass · %s fail\n' "$passed" "$failed"
[ "$failed" = "0" ]
