import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the CDC actor-attribution fix.
 *
 * `enhanceWithAudit` MUST enhance the RAW base client (`~/lib/prismaBase`), not
 * the hooked `~/lib/prisma` client. When ZenStack's `enhance()` wraps a client
 * that itself carries `$extends` query hooks (repositoryCases / testRuns /
 * sessions / issue / …), it routes those models' writes through a path that
 * SKIPS the post-enhance `audit-guc` `$extends` — so the `app.audit_context`
 * GUC is never set and the primary entities materialize in the audit log with a
 * blank actor + null operationId ("System"). Enhancing the un-hooked base
 * client makes the audit-guc `$allOperations` fire for every model uniformly.
 *
 * This test fails if someone reverts the enhanced client back to the hooked
 * `~/lib/prisma`. It can't reach the live DB/ZenStack path (covered by the
 * RUN_DB_INTEGRATION capture matrix), so it pins the structural invariant.
 */

const { prismaBaseSentinel, enhanceMock } = vi.hoisted(() => ({
  prismaBaseSentinel: { __id: "prismaBase-raw" },
  enhanceMock: vi.fn(),
}));

vi.mock("~/lib/prismaBase", () => ({ prisma: prismaBaseSentinel }));
vi.mock("~/lib/audit/gucContext", () => ({
  buildGucPayload: vi.fn(() => ({})),
}));
vi.mock("@zenstackhq/runtime", () => ({
  enhance: (...args: unknown[]) => enhanceMock(...args),
}));

import { enhanceWithAudit } from "./enhanceWithAudit";

describe("enhanceWithAudit", () => {
  beforeEach(() => {
    enhanceMock.mockReset();
    // enhance(...) is chained with .$extends(...); return a stub that records
    // nothing but supports the chain.
    enhanceMock.mockReturnValue({ $extends: vi.fn((ext) => ext) });
  });

  it("enhances the RAW base client (prismaBase), not the hooked lib/prisma client", () => {
    enhanceWithAudit({
      id: "u1",
      name: "User One",
      email: "u1@example.com",
    } as never);

    expect(enhanceMock).toHaveBeenCalled();
    // The base client handed to enhance() must be the un-hooked prismaBase, so
    // the audit-guc $extends fires for hook-carrying models too.
    expect(enhanceMock.mock.calls[0][0]).toBe(prismaBaseSentinel);
  });
});
