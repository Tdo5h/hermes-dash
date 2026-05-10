#!/usr/bin/env bash
set -euo pipefail

REPO="/root/Repo"
EXPORT="/root/hermes-public-export"
APPLY=0

usage() {
  cat <<'USAGE'
Usage: scripts/replace-repo-with-public-clean.sh [options]

Replaces the working tree of the target git repo with a previously generated
clean public export. The .git directory is preserved. A tar backup is created
before any files are removed.

Options:
  --repo PATH     Git repo to replace. Default: /root/Repo
  --export PATH   Clean export directory. Default: /root/hermes-public-export
  --apply         Actually replace files. Without this, only prints a dry run.
  -h, --help      Show this help.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift
      ;;
    --export)
      EXPORT="${2:-}"
      shift
      ;;
    --apply)
      APPLY=1
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

REPO="$(cd "$REPO" && pwd)"
EXPORT="$(cd "$EXPORT" && pwd)"

if [ ! -d "$REPO/.git" ]; then
  echo "target is not a git repo: $REPO" >&2
  exit 1
fi

if [ ! -f "$EXPORT/docker-compose.yml" ] || [ ! -d "$EXPORT/hermes-chat/app" ]; then
  echo "export does not look complete: $EXPORT" >&2
  exit 1
fi

"$EXPORT/scripts/audit-public-clean.sh" "$EXPORT"

echo "target repo: $REPO"
echo "clean export: $EXPORT"

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "Dry run only. To replace the repo working tree, rerun with --apply."
  rsync -ain --delete --exclude '.git' "$EXPORT/" "$REPO/" | sed -n '1,120p'
  exit 0
fi

backup_dir="/root/repo-backups"
mkdir -p "$backup_dir"
backup="$backup_dir/$(basename "$REPO")-before-public-clean-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$backup" -C "$REPO" --exclude .git .
echo "backup written: $backup"

find "$REPO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
rsync -a "$EXPORT/" "$REPO/"

git -C "$REPO" status --short
echo
echo "Repo working tree replaced. Review git diff, then commit and push when ready."
