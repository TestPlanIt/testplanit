/**
 * Bounds of one LLM re-rank, shared by the dialog, the route and the service.
 * Lives in lib/schemas (not lib/services/risk) so a client component can
 * import the cap without pulling server-only modules into the bundle.
 */

/** Most candidates one re-rank may consider; the rest keep their score order. */
export const RERANK_MAX_CANDIDATES = 100;

/** Longest rationale kept per case. */
export const RATIONALE_MAX_CHARS = 300;
