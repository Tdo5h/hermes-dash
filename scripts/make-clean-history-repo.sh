#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="/root/hermes-public-clean-git"
BRANCH="main"
REMOTE=""

usage() {
  cat <<'USAGE'
Usage: scripts/make-clean-history-repo.sh [options]

Creates a separate git repository with a single clean commit from this working
tree. Use this when publishing publicly so old local history is not pushed.

Options:
  --out PATH      Output repo directory. Default: /root/hermes-public-clean-git
  --branch NAME   Branch name. Default: main
  --remote URL    Optional origin remote to add to the clean repo.
  -h, --help      Show this help.

This script does not push. Review the clean repo, then push from that directory
when you are ready.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)
      OUT="${2:-}"
      shift
      ;;
    --branch)
      BRANCH="${2:-}"
      shift
      ;;
    --remote)
      REMOTE="${2:-}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

OUT_PARENT="$(mkdir -p "$(dirname "$OUT")" && cd "$(dirname "$OUT")" && pwd)"
OUT="$OUT_PARENT/$(basename "$OUT")"

case "$OUT" in
  /|"$ROOT"|/root|/opt)
    echo "refusing unsafe output path: $OUT" >&2
    exit 1
    ;;
esac

cd "$ROOT"
scripts/audit-public-clean.sh "$ROOT"
scripts/verify-hermes-integration-patches.sh

rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  "$ROOT/" "$OUT/"

git -C "$OUT" init -b "$BRANCH"
git -C "$OUT" add -A
git -C "$OUT" \
  -c user.name="Hermes Public Export" \
  -c user.email="hermes-public@example.invalid" \
  commit -m "Initial clean HermesChat release"

if [ -n "$REMOTE" ]; then
  git -C "$OUT" remote add origin "$REMOTE"
fi

cat <<EOF
Clean-history repo written to:
  $OUT

Review it there before publishing. To replace an existing public repository:
  cd "$OUT"
  git remote add origin <repo-url>   # if you did not pass --remote
  git push --force origin "$BRANCH"
EOF
