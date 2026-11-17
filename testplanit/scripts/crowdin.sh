#!/bin/sh
# Runs the Crowdin CLI against the copy of the strings that belongs to this
# checkout's release line, so main and a release branch never overwrite each
# other's source strings.
#
#   main, and branches off it        -> the project root
#   release/vX.Y, and branches off it -> the Crowdin branch "vX.Y"
#
# Strings with the same key and English text share one translation across
# Crowdin branches (project setting: duplicate strings "Show within a version
# branch (strict detection)"), so a line only translates its own new strings.
# CROWDIN_BRANCH overrides the detection; set it empty to target the root.
#
# Usage: sh scripts/crowdin.sh sources|translations|auto-translate|download|sync|target [crowdin options]
# Run from the testplanit directory (where crowdin.yml lives).
set -eu

resolve_branch() {
  if [ "${CROWDIN_BRANCH+set}" = set ]; then
    printf '%s' "$CROWDIN_BRANCH"
    return
  fi

  current=${GITHUB_REF_NAME:-$(git branch --show-current 2>/dev/null || true)}
  case $current in
    main) return ;;
    release/*)
      printf '%s' "${current#release/}"
      return
      ;;
  esac

  # Any other branch belongs to the release line whose commits it shares that
  # main lacks. Older lines share commits too (each line was cut from the one
  # before), so the line with the closest common commit wins.
  main_ref=$(git rev-parse -q --verify refs/remotes/origin/main ||
    git rev-parse -q --verify refs/heads/main) || return 0
  line=
  line_base=
  for ref in $(git for-each-ref --format='%(refname)' refs/heads/release refs/remotes/origin/release); do
    base=$(git merge-base HEAD "$ref") || continue
    if git merge-base --is-ancestor "$base" "$main_ref"; then
      continue
    fi
    if [ -z "$line" ] || git merge-base --is-ancestor "$line_base" "$base"; then
      line=${ref#refs/heads/release/}
      line=${line#refs/remotes/origin/release/}
      line_base=$base
    fi
  done
  printf '%s' "$line"
}

# Same substitution the Crowdin CLI applies to branch names
BRANCH=$(resolve_branch | sed 's#[/\\:*?"<>|]#.#g')

run() {
  if [ -n "$BRANCH" ]; then
    crowdin "$@" --branch "$BRANCH"
  else
    crowdin "$@"
  fi
}

branch_exists() {
  [ -z "$BRANCH" ] && return 0
  branches=$(crowdin branch list -o plain) || {
    echo "Could not list Crowdin branches" >&2
    exit 1
  }
  printf '%s\n' "$branches" | grep -Fqx "$BRANCH"
}

if [ -n "$BRANCH" ]; then
  echo "Crowdin target: branch \"$BRANCH\"" >&2
else
  echo "Crowdin target: project root" >&2
fi

action=${1:-}
if [ $# -gt 0 ]; then
  shift
fi

case $action in
  target) ;;
  sources) run upload sources "$@" ;;
  translations) run upload translations "$@" ;;
  # The AI prompt preserves ICU's `#` and named arguments; the MT engine
  # translated `#` as a literal number sign. --scope untranslated never
  # revisits an existing translation.
  auto-translate) run auto-translate --method=ai --ai-prompt=536391 --scope untranslated "$@" ;;
  download) run download "$@" ;;
  sync)
    if branch_exists; then
      # Corrections in messages/*.json go up while Crowdin still holds the
      # English they translate. Uploading sources first would clear every
      # changed string's translation and this step would restore the stale
      # text, leaving auto-translate nothing to do.
      run upload translations
      run upload sources
    else
      # A new release line: the source upload creates the Crowdin branch, and
      # strings that match main's inherit its translations.
      run upload sources
      run upload translations
    fi
    run auto-translate --method=ai --ai-prompt=536391 --scope untranslated
    run download
    ;;
  *)
    echo "Usage: sh scripts/crowdin.sh sources|translations|auto-translate|download|sync|target [crowdin options]" >&2
    exit 64
    ;;
esac
