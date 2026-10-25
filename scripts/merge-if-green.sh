#!/usr/bin/env bash
# Gate 2: refuses a branch that doesn't declare itself finished, merges, runs the
# whole eval suite, and rolls the merge back if anything turns red.
# Usage: scripts/merge-if-green.sh <branch>
set -euo pipefail

branch="${1:?usage: merge-if-green.sh <branch>}"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

declares_finished() {
  if git log -1 --format=%B "$branch" | grep -q "Listo-para-merge: si"; then
    return 0
  fi
  local files
  files="$(git ls-tree -r --name-only "$branch" -- specs/done 2>/dev/null | grep '\.md$' || true)"
  for f in $files; do
    if git show "$branch:$f" 2>/dev/null | grep -q '^status: implementada$'; then
      return 0
    fi
  done
  return 1
}

if ! declares_finished; then
  echo "REFUSED: '$branch' does not declare itself finished." >&2
  echo "  Needs either a 'Listo-para-merge: si' trailer on its last commit," >&2
  echo "  or a specs/done/*.md on that branch with 'status: implementada'." >&2
  exit 1
fi

pre_merge_sha="$(git rev-parse main)"
git checkout main
git merge --no-ff "$branch" -m "Merge $branch (Gate 2)"

if bash evals/run.sh; then
  git push origin main
  worktree_path="$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{p=$2} /^branch /{if ($2==b) print p}')"
  if [ -n "${worktree_path:-}" ]; then
    git worktree remove "$worktree_path" --force
  fi
  git branch -d "$branch" 2>/dev/null || git branch -D "$branch"
  echo "MERGED: $branch into main, pushed, worktree and branch cleaned up."
else
  echo "ROLLED BACK: evals failed after merging $branch — reverting." >&2
  git reset --hard "$pre_merge_sha"
  exit 1
fi
