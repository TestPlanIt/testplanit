// lib/prisma.ts
// v2 compatibility shim. The PrismaClient + enhance() setup and the big
// `$extends` audit / Elasticsearch / webhook hooks moved to lib/zenstack.ts and
// lib/zenstack-plugins/sideEffectsPlugin.ts. This file is kept so the many
// existing `import { prisma } from "@/lib/prisma"` (and the few `{ db }`) call
// sites keep resolving while they are migrated.
//
//   prisma -> baseClient   (audit/ES/webhook side-effects)
//   db     -> policyClient  (access-policy enforced; anonymous unless $setAuth'd)
export { baseClient as prisma, policyClient as db } from "./zenstack";
