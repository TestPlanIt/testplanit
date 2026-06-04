import { afterEach, describe, expect, it, vi } from "vitest";

// lib/bullPrefix.ts reads process.env at module load, so each case needs a
// fresh module instance.
async function loadModule() {
  vi.resetModules();
  return import("./bullPrefix");
}

describe("BULLMQ_PREFIX", () => {
  afterEach(() => {
    delete process.env.BULLMQ_PREFIX;
  });

  it('defaults to "bull" when env is unset (zero-migration invariant)', async () => {
    // "bull" is BullMQ's built-in default prefix: with the env unset, every
    // Redis key is byte-identical to a build without prefix support. If this
    // test ever fails, deploying the image silently strands all existing jobs.
    delete process.env.BULLMQ_PREFIX;
    const { BULLMQ_PREFIX } = await loadModule();
    expect(BULLMQ_PREFIX).toBe("bull");
  });

  it('defaults to "bull" when env is empty string', async () => {
    process.env.BULLMQ_PREFIX = "";
    const { BULLMQ_PREFIX } = await loadModule();
    expect(BULLMQ_PREFIX).toBe("bull");
  });

  it("uses the env value when set", async () => {
    process.env.BULLMQ_PREFIX = "bull-heavy";
    const { BULLMQ_PREFIX } = await loadModule();
    expect(BULLMQ_PREFIX).toBe("bull-heavy");
  });

  it("throws on a prefix containing a colon", async () => {
    process.env.BULLMQ_PREFIX = "bull:heavy";
    await expect(loadModule()).rejects.toThrow(/Invalid BULLMQ_PREFIX/);
  });

  it("throws on other invalid characters", async () => {
    process.env.BULLMQ_PREFIX = "bull heavy";
    await expect(loadModule()).rejects.toThrow(/Invalid BULLMQ_PREFIX/);
  });

  it("allows alphanumerics, underscore and hyphen", async () => {
    process.env.BULLMQ_PREFIX = "Bull_Group-2";
    const { BULLMQ_PREFIX } = await loadModule();
    expect(BULLMQ_PREFIX).toBe("Bull_Group-2");
  });
});
