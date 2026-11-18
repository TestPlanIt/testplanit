import { describe, expect, it, vi } from "vitest";

describe("auditTxStore across module copies", () => {
  it("shares one store between separately loaded copies of the module", async () => {
    vi.resetModules();
    const copyA = await import("./auditTxStore");
    vi.resetModules();
    const copyB = await import("./auditTxStore");

    const tx = { marker: "tx" } as never;
    copyA.auditTxStore.run(tx, () => {
      expect(copyB.auditTxStore.getStore()).toBe(tx);
    });
  });
});
