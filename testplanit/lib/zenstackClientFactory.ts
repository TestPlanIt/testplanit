// lib/zenstackClientFactory.ts
//
// The one place an ORM client is constructed. The app's rawClient (and the
// base / policy views derived from it), the standalone clients that scripts
// and tests create, and the per-tenant worker clients all come through here,
// so every one of them carries the plugins that must never be missing — a
// worker path escaped them before because its client was built elsewhere.
// `new ZenStackClient(...)` anywhere else is an ESLint error.
import { ZenStackClient, type ClientOptions } from "@zenstackhq/orm";
import { schema } from "~/zenstack/schema";

import { jsonNullPlugin } from "./zenstack-plugins/jsonNullPlugin";

export function createAppZenStackClient(options: ClientOptions<typeof schema>) {
  return new ZenStackClient(schema, options).$use(jsonNullPlugin);
}
