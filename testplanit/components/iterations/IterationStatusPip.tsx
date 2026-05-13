import type { ReactNode } from "react";

/**
 * Surface A.3 — Status pip glyph for an iteration row.
 *
 * Six locked glyphs derived from the iteration's `Status` row plus an
 * `isActive` indicator. All glyphs render as inline SVG so they color-mix
 * with `hsl(var(--token))` cleanly. See UI-SPEC § Status Pip Color Map.
 */

export type IterationStatusGlyph =
  | "notStarted"
  | "active"
  | "passed"
  | "failed"
  | "skipped"
  | "blocked";

export const PIP_PATHS: Record<IterationStatusGlyph, ReactNode> = {
  notStarted: (
    <circle
      cx="5"
      cy="5"
      r="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  active: <path d="M2 1.5 L8.5 5 L2 8.5 Z" fill="currentColor" />,
  passed: (
    <>
      <circle cx="5" cy="5" r="4.5" fill="currentColor" />
      <path
        d="M3 5 L4.5 6.5 L7 3.5"
        stroke="hsl(var(--background))"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  failed: <circle cx="5" cy="5" r="4.5" fill="currentColor" />,
  skipped: (
    <rect
      x="1.5"
      y="4.25"
      width="7"
      height="1.5"
      rx="0.5"
      fill="currentColor"
    />
  ),
  blocked: <path d="M5 1 L9 8.5 L1 8.5 Z" fill="currentColor" />,
};

export interface IterationStatusLike {
  isSuccess?: boolean;
  isFailure?: boolean;
  isCompleted?: boolean;
  systemName?: string | null;
}

/**
 * Resolves the appropriate glyph from a `Status` row plus the active flag.
 * - Active in-progress wins over not-started when the iteration has no
 *   recorded result yet.
 * - Completed glyph wins over active when the iteration has been completed.
 */
export function glyphFromStatus(
  status: IterationStatusLike | null | undefined,
  isActive: boolean
): IterationStatusGlyph {
  if (status?.isCompleted) {
    if (status.isSuccess) return "passed";
    if (status.isFailure) return "failed";
    if (status.systemName === "blocked") return "blocked";
    return "skipped";
  }
  if (isActive) return "active";
  return "notStarted";
}

/**
 * Resolves a CSS color string for the pip glyph. Workflow-defined
 * `status.color.value` wins for the four "well-known" semantics (passed,
 * failed, blocked); otherwise we fall back to the semantic token. Pure
 * UI-spec colors (notStarted, active, skipped) always use the token.
 */
export function resolvePipColor(
  glyph: IterationStatusGlyph,
  statusColor?: string
): string {
  switch (glyph) {
    case "notStarted":
      return "hsl(var(--muted-foreground))";
    case "active":
      return "hsl(var(--primary))";
    case "passed":
      return statusColor || "hsl(var(--success))";
    case "failed":
      return statusColor || "hsl(var(--destructive))";
    case "skipped":
      return "hsl(var(--muted-foreground))";
    case "blocked":
      return statusColor || "hsl(var(--warning))";
  }
}

export interface IterationStatusPipProps {
  glyph: IterationStatusGlyph;
  statusColor?: string;
  className?: string;
  "aria-label"?: string;
}

export function IterationStatusPip({
  glyph,
  statusColor,
  className,
  ...rest
}: IterationStatusPipProps) {
  return (
    <svg
      viewBox="0 0 10 10"
      className={`w-2.5 h-2.5 shrink-0 ${className ?? ""}`.trim()}
      style={{ color: resolvePipColor(glyph, statusColor) }}
      data-testid="iteration-status-pip"
      data-glyph={glyph}
      aria-hidden={rest["aria-label"] ? undefined : true}
      {...rest}
    >
      {PIP_PATHS[glyph]}
    </svg>
  );
}

export default IterationStatusPip;
