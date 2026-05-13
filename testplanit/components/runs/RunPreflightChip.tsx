"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { PreflightResult } from "~/lib/types/iterationCardinality";
import { cn } from "~/utils";

export interface RunPreflightChipProps {
  caseIds: number[];
  configIds: number[];
  projectId: number;
  /**
   * Fired when the user clicks the chip while in the `hardRefuse` band.
   * The parent uses the result to open the breakdown dialog (Surface E.2).
   */
  onClick?: (result: PreflightResult) => void;
  /**
   * Notifies the parent every time the preflight result changes so the
   * parent can gate its Submit handler on the latest classification.
   */
  onResult?: (result: PreflightResult | undefined) => void;
}

/**
 * Surface E.1 — Pre-flight cardinality chip.
 *
 * Renders to the LEFT of the Submit button in `AddTestRunModal` Step 1.
 * Queries `/api/test-runs/preflight-cardinality` whenever `caseIds` or the
 * config-count changes (debounced 250 ms) and shows a band-coloured Badge.
 */
export function RunPreflightChip({
  caseIds,
  configIds,
  projectId,
  onClick,
  onResult,
}: RunPreflightChipProps) {
  const t = useTranslations("parameters");

  // Debounce the inputs so a fast-changing case selection (e.g. select-all
  // followed by deselect) doesn't hammer the preflight endpoint. Server-side
  // enforcement is the source of truth — the chip is just a hint.
  const [debouncedCaseIds, setDebouncedCaseIds] = useState<number[]>(caseIds);
  const [debouncedConfigCount, setDebouncedConfigCount] = useState<number>(
    configIds.length
  );
  const sortedKey = caseIds
    .slice()
    .sort((a, b) => a - b)
    .join(",");
  const configCount = configIds.length;

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedCaseIds(caseIds.slice().sort((a, b) => a - b));
      setDebouncedConfigCount(configCount);
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKey, configCount]);

  const { data } = useQuery<PreflightResult>({
    queryKey: [
      "preflight-cardinality",
      projectId,
      debouncedCaseIds.join(","),
      debouncedConfigCount,
    ],
    queryFn: async () => {
      const res = await fetch("/api/test-runs/preflight-cardinality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseIds: debouncedCaseIds,
          configIds: configIds.slice(0, debouncedConfigCount),
          projectId,
        }),
      });
      if (!res.ok) {
        throw new Error(`Preflight failed: ${res.status}`);
      }
      return (await res.json()) as PreflightResult;
    },
    enabled: debouncedCaseIds.length > 0,
    staleTime: 5_000,
  });

  // Surface the latest result to the parent so it can gate Submit.
  useEffect(() => {
    onResult?.(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.classification, data?.total]);

  if (!data || data.total === 0) {
    return null;
  }

  const { total, classification, thresholds, perCase } = data;
  const cases = perCase.length;
  const configs = Math.max(1, debouncedConfigCount);

  let variant: "secondary" | "outline" | "destructive";
  let icon: typeof Layers;
  let extraClass: string;
  let label: string;
  switch (classification) {
    case "sync":
      variant = "secondary";
      icon = Layers;
      extraClass = "bg-primary/10 text-primary border-transparent";
      label = t("runPreflightSync", { n: total });
      break;
    case "async":
      variant = "secondary";
      icon = Layers;
      extraClass = "bg-secondary text-secondary-foreground";
      label = t("runPreflightAsync", { n: total });
      break;
    case "softConfirm":
      variant = "outline";
      icon = AlertTriangle;
      extraClass = "bg-warning/10 text-warning-foreground border-warning/30";
      label = t("runPreflightSoftConfirm", { n: total });
      break;
    case "hardRefuse":
    default:
      variant = "destructive";
      icon = Ban;
      extraClass = "bg-destructive/10 text-destructive border-destructive/30";
      label = t("runPreflightHardRefuse", {
        n: total,
        cap: thresholds.hardCap,
      });
      break;
  }

  const Icon = icon;
  const clickable = classification === "hardRefuse" && Boolean(onClick);

  const chip = (
    <Badge
      variant={variant}
      data-testid="run-preflight-chip"
      data-classification={classification}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? () => {
              onClick?.(data);
            }
          : undefined
      }
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.(data);
              }
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-1.5 tabular-nums",
        clickable && "cursor-pointer",
        extraClass
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      <span>{label}</span>
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{chip}</span>
      </TooltipTrigger>
      <TooltipContent>
        {t("runPreflightTooltip", {
          iterations: total,
          cases,
          configs,
        })}
      </TooltipContent>
    </Tooltip>
  );
}
