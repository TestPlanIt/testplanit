"use client";

import { useDebounce } from "@/components/Debounce";
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
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterDimension } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { isCommittable } from "./chipHelpers";
import { editorOperatorLabelKey } from "./dimensionPresentation";
import { FilterValueList } from "./FilterValueList";
import type { FilterValueOption } from "./valueOptions";

// Value types whose editors are the embedded FilterInputs (which own their
// operator Select); list-backed types get the editor-level operator Select.
const LIST_VALUE_TYPES = new Set(["idList", "userList", "options", "boolean"]);

// Free-text-driven value types: value-only edits are debounced before being
// committed; operator changes and list/date picks commit immediately.
const DEBOUNCED_VALUE_TYPES = new Set(["text", "link", "number", "steps"]);

const DEBOUNCE_MS = 300;

export interface FilterChipEditorProps {
  dimension: FilterDimension;
  predicate: FilterPredicate;
  options: FilterValueOption[];
  /**
   * Commit path. Emits complete predicates — except list editors, where
   * deselecting the last value of a min-1 operator intentionally emits an
   * empty values array so useRepositoryFilters can remove the chip.
   */
  onChange: (next: FilterPredicate) => void;
  countsMuted?: boolean;
}

export function FilterChipEditor({
  dimension,
  predicate,
  options,
  onChange,
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

  const [pending, setPending] = useState<FilterPredicate | null>(null);
  const debouncedPending = useDebounce(pending, DEBOUNCE_MS);
  // Identity guard: the effect must not re-send when a re-render (or an
  // onChange identity change) refires it with an already-committed value.
  const lastSentRef = useRef<FilterPredicate | null>(null);
  useEffect(() => {
    if (debouncedPending && debouncedPending !== lastSentRef.current) {
      lastSentRef.current = debouncedPending;
      onChange(debouncedPending);
    }
  }, [debouncedPending, onChange]);

  const commitImmediate = (next: FilterPredicate) => {
    setPending(null);
    lastSentRef.current = next;
    onChange(next);
  };

  const handleInputChange = (value: FilterInputValue) => {
    const next: FilterPredicate = {
      dimension: dimension.key,
      operator: value.operator,
      values: value.values,
    };
    setDraft(next);
    if (
      value.operator === predicate.operator &&
      DEBOUNCED_VALUE_TYPES.has(dimension.valueType)
    ) {
      setPending(next);
    } else {
      commitImmediate(next);
    }
  };

  const handleOperatorChange = (operator: string) => {
    const next: FilterPredicate = { ...draft, operator };
    setDraft(next);
    if (isCommittable(next, dimension)) {
      commitImmediate(next);
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
    commitImmediate(next);
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

  return (
    <div className="flex flex-col gap-2" data-testid="filter-chip-editor">
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
          {...inputProps}
          fieldType={dimension.fieldType ?? "Number"}
        />
      )}
      {dimension.valueType === "steps" && <StepsFilterInput {...inputProps} />}
      {dimension.valueType === "date" && <DateFilterInput {...inputProps} />}
      {dimension.valueType === "text" && <TextFilterInput {...inputProps} />}
      {dimension.valueType === "link" && <LinkFilterInput {...inputProps} />}
    </div>
  );
}
