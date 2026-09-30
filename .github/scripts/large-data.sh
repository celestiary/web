#!/usr/bin/env bash
# Helpers for PR previews' handling of large data (.github/large-data-paths).
#
#   large-data.sh changed BASE HEAD   Print "true" if the commits differ under
#                                     any large-data path, else "false".
#   large-data.sh strip DIR           Delete the large-data paths from DIR (a
#                                     build output, e.g. docs).
set -euo pipefail

list="$(dirname "$0")/../large-data-paths"

paths() {
  grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$list"
}

case "${1:-}" in
  changed)
    specs=()
    while read -r p; do specs+=("public/${p}"); done < <(paths)
    if [ -n "$(git diff --name-only "$2" "$3" -- "${specs[@]}")" ]; then
      echo true
    else
      echo false
    fi
    ;;
  strip)
    while read -r p; do rm -rf "${2:?}/${p}"; done < <(paths)
    ;;
  *)
    echo "usage: $0 changed BASE HEAD | strip DIR" >&2
    exit 2
    ;;
esac
