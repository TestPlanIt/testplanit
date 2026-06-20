// lib/zenstack-plugins/sideEffectsPlugin.ts
//
// ORM plugin carrying the write-side effects that lived in the v2 lib/prisma.ts
// `$extends({ query: { ... } })` block: audit logging, Elasticsearch sync,
// outbound webhook emission, and write-time business logic (e.g. auto-setting
// completedAt, draft-case exclusion).
//
// v2 -> v3 mapping (filled in by the $extends port):
//   - arg-mutating business logic + bulk-op audit -> onQuery
//   - single-entity audit + ES sync (post-commit)  -> onEntityMutation,
//       runAfterMutationWithinTransaction: false
//   - webhook emission (atomic with the write)       -> onEntityMutation,
//       runAfterMutationWithinTransaction: true
//
// The v2 implementation is preserved in git history (lib/prisma.ts at the commit
// that introduced the v3 deps). Until the port lands this is a no-op so the
// client layer in lib/zenstack.ts stands up; audit/ES/webhook side-effects do
// not fire on this branch until then.
import { definePlugin } from "@zenstackhq/orm";

import { schema } from "~/zenstack/schema";

export const sideEffectsPlugin = definePlugin(schema, {
  id: "testplanit-side-effects",
});
