import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTenantContext,
  runWithTenantContext,
  withTenantContext,
} from "./tenantContext";

vi.mock("./tenantSecrets", () => ({
  getTenantEncryptionKey: vi.fn(async (tenantId: string) => `key-for-${tenantId}`),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("runWithTenantContext", () => {
  it("populates context with resolved key for the duration of fn", async () => {
    expect(getTenantContext()).toBeUndefined();

    const seen = await runWithTenantContext("acme", async () => {
      return getTenantContext();
    });

    expect(seen).toEqual({ tenantId: "acme", encryptionKey: "key-for-acme" });
    expect(getTenantContext()).toBeUndefined();
  });

  it("isolates concurrent tenants", async () => {
    const results = await Promise.all([
      runWithTenantContext("a", async () => getTenantContext()?.tenantId),
      runWithTenantContext("b", async () => getTenantContext()?.tenantId),
    ]);
    expect(results).toEqual(["a", "b"]);
  });

  it("passes through untouched when tenantId is undefined (single-tenant mode)", async () => {
    const result = await runWithTenantContext(undefined, async () => {
      return getTenantContext();
    });
    expect(result).toBeUndefined();
  });
});

describe("withTenantContext", () => {
  it("wraps a BullMQ-style processor and sets context from job.data.tenantId", async () => {
    const processor = vi.fn(async (_job: any) => getTenantContext());
    const wrapped = withTenantContext(processor);

    const ctx = await wrapped({ data: { tenantId: "acme" } });

    expect(ctx).toEqual({ tenantId: "acme", encryptionKey: "key-for-acme" });
    expect(processor).toHaveBeenCalledOnce();
  });

  it("passes the job through unchanged", async () => {
    const processor = vi.fn(async (job: any) => job);
    const wrapped = withTenantContext(processor);

    const job = { id: "1", data: { tenantId: "acme", extra: 42 } };
    const result = await wrapped(job);

    expect(result).toBe(job);
  });

  it("runs without context when job has no tenantId", async () => {
    const processor = vi.fn(async () => getTenantContext());
    const wrapped = withTenantContext(processor);

    const ctx = await wrapped({ data: {} });

    expect(ctx).toBeUndefined();
  });
});
