"use client";

import { DateFilterInput } from "@/components/DateFilterInput";
import type { FilterInputValue } from "@/components/filterInputValue";
import { LinkFilterInput } from "@/components/LinkFilterInput";
import { NumericFilterInput } from "@/components/NumericFilterInput";
import { StepsFilterInput } from "@/components/StepsFilterInput";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { TextFilterInput } from "@/components/TextFilterInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { FilterDimension } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { isCommittable } from "./chipHelpers";
import { editorOperatorLabelKey } from "./dimensionPresentation";
import { FilterValueList } from "./FilterValueList";
import type { FilterValueOption } from "./valueOptions";

// Value types whose editors are the embedded FilterInputs (which own their
// operator Select); list-backed types get the editor-level operator Select.
const LIST_VALUE_TYPES = new Set(["idList", "userList", "options", "boolean"]);

// Typed value types: everything the user has to key in. These never commit
// on edit — not on a keystroke and not on an operator switch — because each
// commit is a URL write that re-reads `predicates` a round-trip later, which
// both unmounts the editor mid-entry and races the next write. They are held
// here and applied once, on confirm (Enter / the apply button) or when the
// editor closes. List, boolean and date picks stay live: one click there is
// already an unambiguous, complete choice.
const TYPED_VALUE_TYPES = new Set(["text", "link", "number", "steps"]);

export interface FilterChipEditorProps {
  dimension: FilterDimension;
  predicate: FilterPredicate;
  options: FilterValueOption[];
  /**
   * Live commit path, used by the list, boolean and date editors. Emits
   * complete predicates — except list editors, where deselecting the last
   * value of a min-1 operator intentionally emits an empty values array so
   * useRepositoryFilters can remove the chip. Typed dimensions never commit
   * through here; they report via `onPendingChange` instead.
   */
  onChange: (next: FilterPredicate) => void;
  /**
   * Reports a typed dimension's in-progress value on every edit, without
   * committing it. The bar keeps the latest one so closing the editor can
   * apply it. Null once the entry is no longer complete enough to apply.
   */
  onPendingChange?: (next: FilterPredicate | null) => void;
  /**
   * Asks for the editor to be closed, which is also what applies a pending
   * typed value. Raised by Enter and the apply button.
   */
  onRequestClose?: () => void;
  countsMuted?: boolean;
}

export function FilterChipEditor({
  dimension,
  predicate,
  options,
  onChange,
  onPendingChange,
  onRequestClose,
  countsMuted,
}: FilterChipEditorProps) {
  const t = useTranslations();

  // Draft holds states that are not yet committable (e.g. an operator switch
  // to `in`/`all` before any value is picked); the committed predicate prop
  // re-syncs it after every commit.
  const [draft, setDraft] = useState<FilterPredicate>(predicate);
  useEffect(() => {
    setDraft(predicate);
  }, [predicate]);

  const isTypedValue = TYPED_VALUE_TYPES.has(dimension.valueType);

  const handleInputChange = (value: FilterInputValue) => {
    const next: FilterPredicate = {
      dimension: dimension.key,
      operator: value.operator,
      values: value.values,
    };
    setDraft(next);
    if (isTypedValue) {
      // Pending only — see TYPED_VALUE_TYPES.
      onPendingChange?.(isCommittable(next, dimension) ? next : null);
      return;
    }
    onChange(next);
  };

  const handleOperatorChange = (operator: string) => {
    const next: FilterPredicate = { ...draft, operator };
    setDraft(next);
    if (isCommittable(next, dimension)) {
      onChange(next);
    }
  };

  const handleToggle = (id: string | number) => {
    const single = dimension.valueType === "boolean";
    const values = single
      ? [id]
      : draft.values.includes(id)
        ? draft.values.filter((value) => value !== id)
        : [...draft.values, id];
    const next: FilterPredicate = { ...draft, values };
    setDraft(next);
    // Committed even when it empties a min-1 operator: the filters hook
    // removes the chip in that case. Draft chips are gated by the bar.
    onChange(next);
  };

  const structuredValue = useMemo<FilterInputValue>(
    () => ({ operator: predicate.operator, values: predicate.values }),
    [predicate]
  );

  const inputProps = {
    fieldId: dimension.fieldId ?? 0,
    currentFilter: null,
    value: structuredValue,
    onValueChange: handleInputChange,
    operators: dimension.operators,
  };

  // Confirming a typed entry closes the editor, and the close is what applies
  // it — so one editing session is one URL write, whichever way it is ended.
  const typedInputProps = {
    ...inputProps,
    onConfirm: () => onRequestClose?.(),
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="filter-chip-editor"
      data-dimension={dimension.key}
    >
      {LIST_VALUE_TYPES.has(dimension.valueType) && (
        <>
          {dimension.operators.length > 1 && (
            <Select value={draft.operator} onValueChange={handleOperatorChange}>
              <SelectTrigger
                className="w-full h-8 text-xs"
                data-testid="filter-operator-select"
                aria-label={t("common.placeholders.selectOperator")}
              >
                <SelectValue
                  placeholder={t("common.placeholders.selectOperator")}
                />
              </SelectTrigger>
              <SelectContent>
                {dimension.operators.map((operator) => (
                  <SelectItem
                    key={operator}
                    value={operator}
                    className="text-xs"
                  >
                    {t(editorOperatorLabelKey(operator))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <FilterValueList
            options={options}
            selectedValues={draft.values}
            onToggle={handleToggle}
            renderOptionLabel={
              dimension.valueType === "userList"
                ? (option: FilterValueOption) =>
                    typeof option.id === "string" &&
                    !dimension.sentinels?.includes(option.id) ? (
                      <UserNameCell userId={option.id} hideLink />
                    ) : (
                      <span className="truncate">{option.name}</span>
                    )
                : undefined
            }
            countsMuted={countsMuted}
          />
        </>
      )}

      {dimension.valueType === "number" && (
        <NumericFilterInput
          {...typedInputProps}
          fieldType={dimension.fieldType ?? "Number"}
        />
      )}
      {dimension.valueType === "steps" && (
        <StepsFilterInput {...typedInputProps} />
      )}
      {dimension.valueType === "date" && <DateFilterInput {...inputProps} />}
      {dimension.valueType === "text" && (
        <TextFilterInput {...typedInputProps} />
      )}
      {dimension.valueType === "link" && (
        <LinkFilterInput {...typedInputProps} />
      )}
    </div>
  );
}
