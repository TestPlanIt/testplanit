"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { formatIterationValue, type IterationParameterMeta } from "./types";

export interface IterationValuesStripProps {
  valuesJson: Record<string, unknown> | null | undefined;
  snapshotRow: Record<string, unknown> | null | undefined;
  parametersSchema: IterationParameterMeta[];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Surface B.3 — Values chip strip rendered between IterationHeader and the
 * step-execution surface. Renders one chip per parameter with overridden
 * badges + snapshot tooltips. Sensitive values mask as `••••••`.
 */
export function IterationValuesStrip({
  valuesJson,
  snapshotRow,
  parametersSchema,
}: IterationValuesStripProps) {
  const t = useTranslations("parameters");

  const ordered = [...parametersSchema].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  if (!valuesJson || ordered.length === 0) return null;

  return (
    <div
      data-testid="iteration-values-strip"
      className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-card text-xs"
    >
      <span className="text-xs font-medium text-muted-foreground">
        {t("iterationValuesLabel")}
      </span>
      <TooltipProvider delayDuration={300}>
        {ordered.map((p) => {
          const cur = valuesJson?.[p.name];
          const snap = snapshotRow?.[p.name];
          const isOverridden = snapshotRow != null && !valuesEqual(cur, snap);
          const displayCur = formatIterationValue(cur, !!p.sensitive);
          const displaySnap = formatIterationValue(snap, !!p.sensitive);

          const chip = (
            <span
              data-testid={`iteration-values-chip-${p.name}`}
              data-overridden={isOverridden ? "true" : undefined}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono text-[0.8125rem] leading-tight whitespace-nowrap"
            >
              <span>{`@${p.name}:`}</span>
              <span className={p.sensitive ? "font-mono" : ""}>
                {displayCur}
              </span>
              {isOverridden && (
                <Badge
                  variant="outline"
                  className="ml-1 h-4 px-1 text-[0.6875rem] gap-0.5"
                  data-testid={`iteration-values-chip-${p.name}-overridden`}
                >
                  <Pencil className="h-3 w-3" />
                  {t("iterationValueOverridden")}
                </Badge>
              )}
            </span>
          );

          if (!isOverridden) {
            return <span key={p.name}>{chip}</span>;
          }

          return (
            <Tooltip key={p.name}>
              <TooltipTrigger asChild>{chip}</TooltipTrigger>
              <TooltipContent side="top">
                {t("iterationValueSnapshot", { value: displaySnap })}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </div>
  );
}

export default IterationValuesStrip;
