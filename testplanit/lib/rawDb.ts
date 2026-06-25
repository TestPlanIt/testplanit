// lib/rawDb.ts
// The "raw, no side-effects" ZenStack client (no audit / ES sync / webhook
// hooks, no access policy) — rawClient in lib/zenstack.ts. Used by workers and
// the Elasticsearch-sync services that must NOT re-trigger sync hooks on their
// own reads.
export { rawClient as rawDb } from "./zenstack";
