#!/usr/bin/env bash
#
# check-modal-pattern.sh
#
# Prevents regression of the form-state-leak bug class fixed in the
# refactor/modal-form-state-leak branch. See CONTRIBUTING.md
# "Modal Forms" section.
#
# This script enforces three rules:
#
# 1. Tier-3 regression guard: the modal files that were originally
#    migrated to the pure-form-component pattern must not regrow
#    DialogTrigger imports or local `[open, setOpen]` state.
#
# 2. Forward check (narrow): no file may combine `useForm(`, a local
#    `[open, setOpen] = useState(false)`, AND `<DialogTrigger` without
#    a `reset()` mitigation. That is the exact original pre-fix shape.
#
# 3. Forward check (broad): no file may combine ANY local open-state
#    useState (matching `[<name>Open, set<Name>Open]` or `[open, setOpen]`)
#    AND `<DialogTrigger`. This catches the bug class beyond just forms:
#    any modal that manages its own trigger has latent-leak potential.
#    The only exception is self-opening modals (e.g. the onboarding
#    dialog) which may be listed in the ALLOWLIST below.
#
# Exits non-zero if any rule fails.
#
# Invocation:   pnpm check:modal-pattern
# Or directly:  bash scripts/check-modal-pattern.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# --- Rule 1: regression guard for the originally-migrated tier-3 files ---

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
  echo "See CONTRIBUTING.md -> 'Modal Forms' for the expected shape."
  exit 1
fi

# --- Rule 2: narrow forward check for the exact pre-fix buggy shape ------

# Find candidate files: have useForm, local open state, and a DialogTrigger.
# Exclude .test.tsx and .spec.tsx files — tests may render components
# differently for isolation.
NARROW_CANDIDATES=$(
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
if [ -n "$NARROW_CANDIDATES" ]; then
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
  done <<< "$NARROW_CANDIDATES"
fi

if [ ${#BUGGY[@]} -gt 0 ]; then
  echo "ERROR: the following file(s) match the form-state-leak anti-pattern"
  echo "(useForm + local [open, setOpen] state + DialogTrigger, with no"
  echo "reset mitigation):"
  printf '  - %s\n' "${BUGGY[@]}"
  echo
  echo "Fix by migrating to the approach-B pattern: lift the trigger button"
  echo "and open-state up to the parent, accept { open, onClose } as"
  echo "props, and have the parent conditionally mount the form:"
  echo
  echo "    {addXxxOpen && <AddXxx open={addXxxOpen} onClose={...} />}"
  echo
  echo "See CONTRIBUTING.md -> 'Modal Forms' and AddTag.tsx for a"
  echo "reference implementation."
  exit 1
fi

# --- Rule 3: broad forward check for any local-state-plus-trigger modal --

# Files that are allowed to manage their own trigger + open state.
# Candidates include auto-opening dialogs that cannot be opened by a
# user-controlled trigger at all (e.g., the onboarding dialog opens
# itself when user preferences are unset). Add with extreme caution.
BROAD_ALLOWLIST=(
  # Onboarding dialog auto-opens; no user-visible trigger button.
  "components/onboarding/InitialPreferencesDialog.tsx"
  # FieldValueInput is an inline cell renderer in a bulk-edit table;
  # the embedded steps dialog is per-row and resets its form via a
  # useEffect(() => if (isStepsDialogOpen) reset(...)) which correctly
  # re-initializes from the current cell value on every open.
  "app/[locale]/projects/repository/[projectId]/FieldValueInput.tsx"
)

# Find files with ANY local open-state useState + DialogTrigger.
# Matches both `[open, setOpen]` and `[xxxOpen, setXxxOpen]` shapes.
BROAD_CANDIDATES=$(
  grep -rlE '\bDialogTrigger\b|\bAlertDialogTrigger\b' \
    --include='*.tsx' \
    --exclude='*.test.tsx' \
    --exclude='*.spec.tsx' \
    app components 2>/dev/null \
  | xargs grep -lE 'const \[[a-zA-Z_]*[Oo]pen[a-zA-Z_]*, set[A-Z][a-zA-Z_]*[Oo]pen[a-zA-Z_]*\] = useState\(' 2>/dev/null \
  || true
)

BROAD_BUGGY=()
if [ -n "$BROAD_CANDIDATES" ]; then
  while IFS= read -r f; do
    # Skip allowlisted files
    skip=false
    for allowed in "${BROAD_ALLOWLIST[@]}"; do
      if [ "$f" = "$allowed" ]; then
        skip=true
        break
      fi
    done
    if [ "$skip" = true ]; then
      continue
    fi

    # A file is only buggy if the DialogTrigger references the modal
    # component itself (not a nested sub-dialog like a delete confirm
    # inside an edit modal). We use a simple heuristic: check if the
    # file has a Dialog whose open prop is tied to a local [open, setOpen]
    # pattern. If `<Dialog open={someLocalOpen}` appears, flag it.
    if grep -qE '<(Dialog|AlertDialog)[[:space:]]+open=\{[a-zA-Z_]*[Oo]pen[a-zA-Z_]*\}' "$f"; then
      # Also check it has a DialogTrigger directly (not just a nested one)
      if grep -qE '<DialogTrigger|<AlertDialogTrigger' "$f"; then
        BROAD_BUGGY+=("$f")
      fi
    fi
  done <<< "$BROAD_CANDIDATES"
fi

if [ ${#BROAD_BUGGY[@]} -gt 0 ]; then
  echo "ERROR: the following file(s) manage their own open state AND"
  echo "contain a DialogTrigger. Per approach B, the parent should own"
  echo "the open state and conditionally mount the modal:"
  printf '  - %s\n' "${BROAD_BUGGY[@]}"
  echo
  echo "Fix by migrating to the approach-B pattern:"
  echo
  echo "  1. Remove the internal [open, setOpen] useState"
  echo "  2. Accept { open, onClose } (or { open, onOpenChange }) as props"
  echo "  3. Remove the DialogTrigger — the parent renders the button"
  echo "  4. Have the parent conditionally mount the modal"
  echo
  echo "If this file is a legitimate self-opening dialog with no"
  echo "user-facing trigger (like the onboarding dialog), add it to"
  echo "BROAD_ALLOWLIST in scripts/check-modal-pattern.sh with a comment"
  echo "explaining why."
  echo
  echo "See CONTRIBUTING.md -> 'Modal Forms' for the pattern."
  exit 1
fi

echo "ok: modal pattern check passed"
