import { DIMENSION_LABEL_KEYS } from "./reportConstants";

/**
 * Metric ids whose label lives outside `reports.metrics.<id>`. The picker
 * resolves labels by id at runtime, so every id must map to a key that
 * exists; ids left out fall back to the `reports.metrics` namespace.
 */
export const METRIC_LABEL_KEYS: Record<string, string> = {
  totalElapsedTime: "common.fields.totalElapsed",
};

/** Message key for a report dimension's display label. */
export function dimensionLabelKey(dimensionId: string): string {
  return (
    DIMENSION_LABEL_KEYS[dimensionId] ?? `reports.dimensions.${dimensionId}`
  );
}

/** Message key for a report metric's display label. */
export function metricLabelKey(metricId: string): string {
  return METRIC_LABEL_KEYS[metricId] ?? `reports.metrics.${metricId}`;
}

/**
 * Whether a translator knows `key`. Falls back to true for translators
 * without `has` (test doubles), so the caller still asks for the key.
 */
export function hasMessage(t: unknown, key: string): boolean {
  const has = (t as { has?: (k: string) => boolean }).has;
  return typeof has === "function" ? has.call(t, key) : true;
}
