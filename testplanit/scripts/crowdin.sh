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
# Usage: sh scripts/crowdin.sh sources|translations|auto-translate|download|sync|untranslated|target [crowdin options]
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

# The AI prompt keeps ICU's `#`, argument names and exact selectors (=0, =1).
# The MT engine translated `#` as a literal number sign, and Crowdin's stock AI
# prompt turns `=1` into `one`, which Crowdin then rejects ("ICU structures are
# not the same") and leaves the string untranslated. --scope untranslated never
# revisits an existing translation.
AI_PROMPT=782207

auto_translate() {
  run auto-translate --method=ai --ai-prompt="$AI_PROMPT" --scope untranslated "$@"
}

API=https://api.crowdin.com/api/v2

api_get() {
  curl -fsS -H "Authorization: Bearer $CROWDIN_PERSONAL_TOKEN" "$API$1"
}

# "<language> <untranslated phrases>" for each language that still has holes in
# this line's strings. Auto-translate exits 0 even when Crowdin's QA checks
# reject a translation, so this is the only sign a string stayed in English.
untranslated_by_language() {
  command -v jq >/dev/null 2>&1 || return 0
  project=$(sed -n 's/^project_id: *"\{0,1\}\([0-9]*\).*/\1/p' crowdin.yml)
  if [ -n "$BRANCH" ]; then
    id=$(api_get "/projects/$project/branches?name=$BRANCH" | jq -r '.data[0].data.id // empty')
    [ -n "$id" ] || return 0
    path="/projects/$project/branches/$id/languages/progress?limit=100"
  else
    id=$(api_get "/projects/$project/files?limit=500" |
      jq -r '[.data[].data | select(.branchId == null and .name == "en-US.json")][0].id // empty')
    [ -n "$id" ] || return 0
    path="/projects/$project/files/$id/languages/progress?limit=100"
  fi
  api_get "$path" |
    jq -r '.data[].data | select(.phrases.total > .phrases.translated) | "\(.languageId) \(.phrases.total - .phrases.translated)"'
}

untranslated_total() {
  untranslated_by_language | awk '{ n += $2 } END { print n + 0 }'
}

report_untranslated() {
  left=$(untranslated_by_language)
  [ -n "$left" ] || return 0
  summary=$(printf '%s\n' "$left" | awk '{ printf "%s%s (%s)", sep, $1, $2; sep = ", " }')
  message="Crowdin left strings untranslated, so they download as English: $summary. Open the language in Crowdin and filter by Untranslated to see why each was rejected."
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::warning title=Untranslated strings::$message"
  else
    echo "WARNING: $message" >&2
  fi
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
  auto-translate)
    auto_translate "$@"
    report_untranslated
    ;;
  download) run download "$@" ;;
  untranslated) report_untranslated ;;
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
    auto_translate
    # The AI's answer varies between runs, so a string Crowdin rejected once
    # often passes on a second attempt.
    if [ "$(untranslated_total)" != 0 ]; then
      auto_translate
    fi
    report_untranslated
    run download
    ;;
  *)
    echo "Usage: sh scripts/crowdin.sh sources|translations|auto-translate|download|sync|untranslated|target [crowdin options]" >&2
    exit 64
    ;;
esac
