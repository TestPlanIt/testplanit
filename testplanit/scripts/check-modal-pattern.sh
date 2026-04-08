#!/usr/bin/env bash
#
# check-modal-pattern.sh
#
# Prevents regression of the form-state-leak bug class fixed in the
# refactor/modal-form-state-leak branch. See CLAUDE.md
# "Modal forms must be conditionally mounted by the parent".
#
# This script enforces two rules:
#
# 1. Tier-3 regression guard: the seven modal files that were migrated
#    to the pure-form-component pattern must not regrow DialogTrigger
#    imports, local `[open, setOpen]` state, or unconditional-mount
#    indicators.
#
# 2. Forward check: no file anywhere in the codebase may combine
#    `useForm(`, `const [open, setOpen] = useState(false)`, and
#    `<DialogTrigger` WITHOUT also having a reset mitigation
#    (`reset(` or an `if (open)` / `if (!open)` effect). That is the
#    exact pre-fix shape of the bug.
#
# Exits non-zero if either rule fails.
#
# Invocation:   pnpm check:modal-pattern
# Or directly:  bash scripts/check-modal-pattern.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# --- Rule 1: regression guard for the seven migrated files ---------------

TIER3_FILES=(
  "app/[locale]/admin/tags/AddTag.tsx"
  "app/[locale]/admin/groups/AddGroup.tsx"
  "app/[locale]/users/profile/[userId]/EditAvatar.tsx"
  "app/[locale]/admin/milestones/AddMilestoneTypes.tsx"
  "app/[locale]/admin/fields/AddTemplate.tsx"
  "app/[locale]/projects/milestones/[projectId]/AddMilestoneModal.tsx"
  "app/[locale]/admin/users/AddUser.tsx"
)

REGRESSED=()
for f in "${TIER3_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: expected tier-3 file is missing: $f"
    exit 1
  fi
  if grep -qE '\bDialogTrigger\b' "$f"; then
    REGRESSED+=("$f (imports DialogTrigger)")
  fi
  if grep -qE 'const \[open, setOpen\] = useState\(false\)' "$f"; then
    REGRESSED+=("$f (has local [open, setOpen] state)")
  fi
done

if [ ${#REGRESSED[@]} -gt 0 ]; then
  echo "ERROR: tier-3 modal regression detected in the following file(s):"
  printf '  - %s\n' "${REGRESSED[@]}"
  echo
  echo "These files were migrated to the pure-form-component pattern in"
  echo "the refactor/modal-form-state-leak branch and must remain so."
  echo "See CLAUDE.md -> 'Modal forms must be conditionally mounted by"
  echo "the parent' for the expected shape."
  exit 1
fi

# --- Rule 2: forward check for the exact pre-fix buggy shape --------------

# Find candidate files: have useForm, local open state, and a DialogTrigger.
# Exclude .test.tsx and .spec.tsx files — tests may render components
# differently for isolation.
CANDIDATES=$(
  grep -rlE '\buseForm\b' \
    --include='*.tsx' \
    --exclude='*.test.tsx' \
    --exclude='*.spec.tsx' \
    app components 2>/dev/null \
  | xargs grep -lE 'const \[open, setOpen\] = useState\(false\)' 2>/dev/null \
  | xargs grep -lE '\bDialogTrigger\b' 2>/dev/null \
  || true
)

BUGGY=()
if [ -n "$CANDIDATES" ]; then
  while IFS= read -r f; do
    # A mitigation is any of:
    #   - `reset(` called (suggests form.reset is wired up)
    #   - `if (open)` / `if (!open)` in a useEffect (reset-on-open/close)
    # If neither exists, the file has the pre-fix buggy shape.
    if grep -qE '\breset\(' "$f"; then
      continue
    fi
    if grep -qE 'if \(!?open\)' "$f"; then
      continue
    fi
    BUGGY+=("$f")
  done <<< "$CANDIDATES"
fi

if [ ${#BUGGY[@]} -gt 0 ]; then
  echo "ERROR: the following file(s) match the form-state-leak anti-pattern"
  echo "(useForm + local [open, setOpen] state + DialogTrigger, with no"
  echo "reset mitigation):"
  printf '  - %s\n' "${BUGGY[@]}"
  echo
  echo "Fix by migrating to the tier-3 pattern: lift the trigger button"
  echo "and open-state up to the parent, accept { open, onClose } as"
  echo "props, and have the parent conditionally mount the form:"
  echo
  echo "    {addXxxOpen && <AddXxx open={addXxxOpen} onClose={...} />}"
  echo
  echo "See CLAUDE.md -> 'Modal forms must be conditionally mounted by"
  echo "the parent' and AddTag.tsx for a reference implementation."
  exit 1
fi

echo "ok: modal pattern check passed"
