/**
 * Shared types for the iteration UI surfaces (Phase 3).
 *
 * The Phase 2 `ParameterChipMeta` (in `lib/tiptap/parameterMentionExtension`)
 * is geared toward TipTap chip rendering and does NOT carry the `sensitive`
 * flag that the iteration UI needs for masking. We re-derive a Phase 3 view
 * type from the snapshot's `parametersJson` schema.
 */

export interface IterationParameterMeta {
  id?: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  order?: number;
  sensitive?: boolean;
}

export interface IterationStatusDTO {
  id: number;
  name: string;
  color?: { value: string } | null;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
  systemName?: string | null;
}

export interface IterationDTO {
  id: number;
  rowIndex: number;
  /**
   * Human-readable label inherited from the dataset row this iteration was
   * fanned out from (e.g. "Bad password", "Good username 2"). Surfaced in
   * the values strip as a friendlier identifier than the auto-composed
   * "field: value / field: value" string.
   */
  label: string | null;
  valuesJson: Record<string, unknown>;
  isCompleted: boolean;
  status?: IterationStatusDTO | null;
}

export type IterationMenuAction = "override" | "skip" | "reset";

/**
 * Renders a value cell into its display string. Sensitive values are masked
 * with six bullet chars; `[REDACTED]` from server-side `redactValues()` is
 * also rendered as bullets so the client never has to know which path the
 * server took.
 */
export function formatIterationValue(
  value: unknown,
  sensitive: boolean
): string {
  if (sensitive) return "••••••";
  if (value === "[REDACTED]") return "••••••";
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
