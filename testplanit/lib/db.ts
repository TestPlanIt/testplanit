// lib/db.ts
// Thin re-export of the ZenStack clients under app-friendly names. The
// underlying client factory + the audit / Elasticsearch / webhook side-effect
// hooks live in lib/zenstack.ts and lib/zenstack-plugins/sideEffectsPlugin.ts.
//
//   baseDb -> baseClient    (audit/ES/webhook side-effects; no access policy)
//   db     -> policyClient  (access-policy enforced; anonymous unless $setAuth'd)
export { baseClient as baseDb, policyClient as db } from "./zenstack";
