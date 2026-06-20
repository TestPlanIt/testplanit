// server/db.ts
// v2 compatibility shim. server/db previously exposed a raw PrismaClient that
// deliberately bypassed the audit/ES hooks (Trash + a few admin routes). That
// role is now rawClient in lib/zenstack.ts (no plugins, no policy).
export { rawClient as db } from "~/lib/zenstack";
