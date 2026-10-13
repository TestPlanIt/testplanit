"use client";

import StatusDisplay from "@/components/StatusDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import type { ClassValue } from "~/utils";

interface CaseResultStatusProps {
  caseId: number;
  statusName?: string | null;
  statusColor?: string | null;
  /**
   * The run the result was recorded against. Together with `projectId` it
   * turns the status into a link to that exact execution; a case that has
   * never been executed has no run to open and renders the bare status.
   */
  testRunId?: number | null;
  projectId?: number | string | null;
  /** Test id for the link, so a caller's existing selectors keep working. */
  linkTestId?: string;
  className?: ClassValue;
  nameClassName?: ClassValue;
}

/**
 * A test case's latest result: the status dot and name, linked to the run it
 * came from.
 *
 * Shared so every surface that answers "how did this case last do?" — the
 * requirement coverage drill-down and the linked-cases panel — draws the same
 * badge and links to the same place, instead of each hand-rolling a coloured
 * pill. The destination (and its `selectedCase` param) matches the repository
 * list's Latest Results squares.
 *
 * The two strings live under `requirements.coverage` because that surface
 * introduced them; they are reused verbatim here rather than duplicated.
 */
export function CaseResultStatus({
  caseId,
  statusName,
  statusColor,
  testRunId,
  projectId,
  linkTestId,
  className,
  nameClassName,
}: CaseResultStatusProps) {
  const t = useTranslations();

  const status = (
    <StatusDisplay
      name={statusName ?? t("requirements.coverage.notRunCell")}
      color={statusColor ?? undefined}
      className={className}
      nameClassName={nameClassName}
    />
  );

  if (!testRunId || projectId == null) {
    return status;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/projects/runs/${projectId}/${testRunId}?selectedCase=${caseId}`}
          className="inline-flex min-w-0 hover:underline"
          data-testid={linkTestId}
        >
          {status}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {t("requirements.coverage.resultRunLink")}
      </TooltipContent>
    </Tooltip>
  );
}

export default CaseResultStatus;
