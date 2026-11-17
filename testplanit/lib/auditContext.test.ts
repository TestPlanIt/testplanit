import { describe, expect, it, vi } from "vitest";

describe("auditContextStorage", () => {
  // Next.js can load lib/auditContext once per server layer while the database
  // clients are cached on globalThis; every copy must share one store so the
  // clients' plugins see the context a server action set.
  it("is shared by every loaded copy of the module", async () => {
    const first = await import("./auditContext");
    vi.resetModules();
    const second = await import("./auditContext");

    expect(second).not.toBe(first);
    expect(second.auditContextStorage).toBe(first.auditContextStorage);
    expect(
      first.runWithAuditContext({ userId: "u-1" }, () =>
        second.getAuditContext()
      )
    ).toEqual({ userId: "u-1" });
  });
});
