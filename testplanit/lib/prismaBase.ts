// lib/prismaBase.ts
// v2 compatibility shim. The "raw, no side-effects" client (no audit / ES sync /
// webhook hooks, no access policy) is now rawClient in lib/zenstack.ts. Used by
// workers and the Elasticsearch-sync services that must NOT re-trigger sync
// hooks on their own reads.
export { rawClient as prisma } from "./zenstack";
