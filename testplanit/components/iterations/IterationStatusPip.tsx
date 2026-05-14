/**
 * Surface A.3 — Status pip for an iteration row.
 *
 * Statuses are color-only — no shape semantics. The pip is always a
 * filled circle tinted with the iteration's status color (admin-defined).
 * The `glyph` prop is preserved for API compatibility and used only by
 * `resolvePipColor` to pick a fallback semantic color for the two
 * pseudo-states (`notStarted`, `active`) which have no Status row.
 */

export type IterationStatusGlyph =
  | "notStarted"
  | "active"
  | "passed"
  | "failed"
  | "skipped"
  | "blocked";

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
 * Resolves a CSS color string for the pip. When a real Status row drives
 * the pip, its admin-configured `color.value` is the source of truth and
 * always wins — statuses are color-only, no semantic mapping.
 *
 * The two pseudo-states (notStarted, active) have no Status row; they fall
 * back to a semantic CSS token so light + dark themes both work.
 */
export function resolvePipColor(
  glyph: IterationStatusGlyph,
  statusColor?: string
): string {
  if (statusColor) return statusColor;
  switch (glyph) {
    case "active":
      return "hsl(var(--primary))";
    case "notStarted":
    default:
      return "hsl(var(--muted-foreground))";
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
      <circle cx="5" cy="5" r="4.5" fill="currentColor" />
    </svg>
  );
}

export default IterationStatusPip;
