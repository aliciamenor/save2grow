#!/usr/bin/env bash
# Criterion 1 (spec 003) — the local page is servable with zero extra tooling: `python3 -m
# http.server` run inside web/ serves index.html with no npm install, no build step.
set -u

port="${1:-8787}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/web"
body_file="$(mktemp)"

cd "$root" || exit 1
python3 -m http.server "$port" >/tmp/save2grow-003-serve.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; rm -f "$body_file"' EXIT

# Give the server a moment to bind before asserting anything.
up=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$port/"; then
    up=1
    break
  fi
  sleep 0.2
done

if [ "$up" != "1" ]; then
  echo "FAIL: server never came up on port $port (see /tmp/save2grow-003-serve.log)" >&2
  exit 1
fi

status="$(curl -s -o "$body_file" -w '%{http_code}' "http://localhost:$port/")"

if [ "$status" != "200" ]; then
  echo "FAIL: expected HTTP 200, got $status" >&2
  exit 1
fi

if ! grep -q 'id="app"' "$body_file"; then
  echo "FAIL: response missing the page's expected root element id=\"app\"" >&2
  exit 1
fi

echo "OK: http://localhost:$port/ returned 200 with the expected root element"
exit 0
