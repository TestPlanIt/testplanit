"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { REQUIREMENT_COVERAGE_STATE_ORDER } from "./RequirementCoverageOverview";

/**
 * The traceability report's requirement-level coverage-state filter: a
 * four-state checkbox dropdown (the tree's own state vocabulary). Empty
 * selection means every state; the selection travels as the server-side
 * `coverageStates` body param, so the filtered set is what the counts,
 * the CSV, the visualization, and a share link all describe.
 */
export function RequirementCoverageStateFilter({
  value,
  onValueChange,
}: {
  value: string[];
  onValueChange: (next: string[]) => void;
}) {
  const t = useTranslations("requirements.coverage");

  const labelFor = (status: string) => {
    switch (status) {
      case "PASSED":
        return t("statusPassed");
      case "FAILED":
        return t("statusFailed");
      case "NOT_RUN":
        return t("statusNotRun");
      default:
        return t("uncovered");
    }
  };

  const triggerLabel =
    value.length === 0
      ? t("title")
      : REQUIREMENT_COVERAGE_STATE_ORDER.filter((status) =>
          value.includes(status)
        )
          .map(labelFor)
          .join(", ");

  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium">{t("title")}</label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-between"
            data-testid="requirement-coverage-state-filter"
          >
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ChevronDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {REQUIREMENT_COVERAGE_STATE_ORDER.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={value.includes(status)}
              onCheckedChange={(checked) =>
                onValueChange(
                  checked
                    ? [...value, status]
                    : value.filter((entry) => entry !== status)
                )
              }
              // Keep the menu open across multi-select toggles.
              onSelect={(event) => event.preventDefault()}
            >
              {labelFor(status)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
