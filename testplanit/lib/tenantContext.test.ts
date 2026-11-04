import { DelayedError } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TENANT_CONFIG_GRACE_MS,
  TENANT_CONFIG_RETRY_DELAY_MS,
  getTenantContext,
  runWithTenantContext,
  withTenantContext,
} from "./tenantContext";
import { TenantNotConfiguredError } from "./tenantErrors";

vi.mock("./tenantSecrets", () => ({
  getTenantEncryptionKey: vi.fn(
    async (tenantId: string) => `key-for-${tenantId}`
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.MULTI_TENANT_MODE;
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

  it("passes the worker's lock token through", async () => {
    const processor = vi.fn(async (_job: any, token?: string) => token);
    const wrapped = withTenantContext(processor);

    await expect(wrapped({ data: { tenantId: "acme" } }, "tok")).resolves.toBe(
      "tok"
    );
  });

  it("runs without context when job has no tenantId", async () => {
    const processor = vi.fn(async () => getTenantContext());
    const wrapped = withTenantContext(processor);

    const ctx = await wrapped({ data: {} });

    expect(ctx).toBeUndefined();
  });

  it("warns when a job has no tenantId in multi-tenant mode", async () => {
    process.env.MULTI_TENANT_MODE = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const wrapped = withTenantContext(async () => "ok");
    await wrapped({ data: {} });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tenantContext"));
    warn.mockRestore();
  });

  it("does not warn when a job has no tenantId in single-tenant mode", async () => {
    delete process.env.MULTI_TENANT_MODE;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const wrapped = withTenantContext(async () => "ok");
    await wrapped({ data: {} });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("withTenantContext — tenant not configured yet", () => {
  function fakeJob(ageMs: number) {
    return {
      data: { tenantId: "newco" },
      timestamp: Date.now() - ageMs,
      moveToDelayed: vi.fn(async () => {}),
    };
  }

  it("parks a young job and throws DelayedError instead of failing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const processor = vi.fn(async () => {
        throw new TenantNotConfiguredError("newco");
      });
      const wrapped = withTenantContext(processor);
      const job = fakeJob(30_000);

      await expect(wrapped(job, "tok")).rejects.toBeInstanceOf(DelayedError);

      expect(job.moveToDelayed).toHaveBeenCalledWith(
        Date.now() + TENANT_CONFIG_RETRY_DELAY_MS,
        "tok"
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('tenant "newco" not in this worker')
      );
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("completes normally once the tenant appears, with no attempt consumed", async () => {
    // Simulates BullMQ re-running the delayed job: the processor is invoked
    // again on the same job object and this time the tenant resolves.
    let configured = false;
    const processor = vi.fn(async () => {
      if (!configured) throw new TenantNotConfiguredError("newco");
      return "done";
    });
    const wrapped = withTenantContext(processor);
    const job = fakeJob(30_000);

    await expect(wrapped(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    configured = true;
    await expect(wrapped(job, "tok")).resolves.toBe("done");
    // Each run threw DelayedError or succeeded — never a plain failure, so
    // BullMQ's attemptsMade stays at 0 (the worker only bumps it on failure).
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it("lets the error through once the job is older than the grace window", async () => {
    const processor = vi.fn(async () => {
      throw new TenantNotConfiguredError("gone-co");
    });
    const wrapped = withTenantContext(processor);
    const job = {
      ...fakeJob(TENANT_CONFIG_GRACE_MS + 1),
      data: { tenantId: "gone-co" },
    };

    await expect(wrapped(job, "tok")).rejects.toBeInstanceOf(
      TenantNotConfiguredError
    );
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it("lets the error through when there is no lock token to delay with", async () => {
    const processor = vi.fn(async () => {
      throw new TenantNotConfiguredError("newco");
    });
    const wrapped = withTenantContext(processor);
    const job = fakeJob(1_000);

    await expect(wrapped(job)).rejects.toBeInstanceOf(TenantNotConfiguredError);
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it("does not intercept other errors", async () => {
    const boom = new Error("db down");
    const processor = vi.fn(async () => {
      throw boom;
    });
    const wrapped = withTenantContext(processor);
    const job = fakeJob(1_000);

    await expect(wrapped(job, "tok")).rejects.toBe(boom);
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });
});
