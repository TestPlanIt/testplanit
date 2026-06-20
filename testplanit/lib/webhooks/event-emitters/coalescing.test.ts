import { createHash } from "crypto";

import { ORMError } from "@zenstackhq/orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * emitWithCoalescing — first OUTBOUND consumer of WebhookEventDedup.
 *
 * Per-event emit when the rolling-window count is below threshold; folds
 * subsequent events into a single deterministic-digest summary event when
 * the count is at/above. Race-safe via P2002 on the summary digest.
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_test",
      outboxRowId: "row_test",
    })),
  },
}));

import { webhookEvents } from "~/lib/webhooks/events";

import { emitWithCoalescing } from "./coalescing";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;

function buildFakeTx(opts: {
  configs: Array<{ id: string }>;
  countByConfigId: Record<string, number>;
  createImpl?: (data: {
    webhookConfigId: string;
    payloadDigest: string;
  }) => Promise<unknown>;
}) {
  const findMany = vi.fn(async () => opts.configs);
  const count = vi.fn(
    async ({ where }: { where: { webhookConfigId: string } }) => {
      return opts.countByConfigId[where.webhookConfigId] ?? 0;
    }
  );
  const create = vi.fn(opts.createImpl ?? (async () => ({ id: "dedup_row" })));
  // $executeRaw is called for the per-config pg_advisory_xact_lock that
  // serializes the threshold check; the SQL itself is a no-op in tests.
  const executeRaw = vi.fn(async () => 1);
  // aggregate(_min.processedAt) is called on the threshold-crossing path
  // so the summary's firstAt reports the actual first event in the
  // burst instead of the rolling-window outer bound. The tests don't
  // pin a specific timestamp (only `toBeDefined`); returning a stable
  // Date keeps the call shape valid.
  const aggregate = vi.fn(async () => ({
    _min: { processedAt: new Date("2026-06-09T00:00:00Z") },
  }));
  return {
    tx: {
      webhookConfig: { findMany },
      webhookEventDedup: { count, create, aggregate },
      $executeRaw: executeRaw,
    },
    findMany,
    count,
    create,
    aggregate,
    executeRaw,
  };
}

const basePayload = {
  id: 42,
  projectId: -1,
  externalId: "okta_grp_eng",
  displayName: "Engineering",
  members: [{ value: "u1" }, { value: "u2" }, { value: "u3" }],
};

beforeEach(() => {
  emitMock.mockClear();
});

describe("emitWithCoalescing — below-threshold per-event emit", () => {
  it("emits the per-event payload when window count is below SCIM_COALESCING_THRESHOLD (10)", async () => {
    const { tx, create } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 3 },
    });
    await emitWithCoalescing(
      "scim.group.member_added",
      basePayload,
      tx as never,
      {}
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("scim.group.member_added");
    expect(emitMock.mock.calls[0][1]).toMatchObject(basePayload);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("writes the per-event dedup row with sha256(JSON.stringify(payload)) digest", async () => {
    const { tx, create } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 0 },
    });
    await emitWithCoalescing("scim.user.created", basePayload, tx as never, {});
    const expectedDigest = createHash("sha256")
      .update(JSON.stringify(basePayload))
      .digest("hex");
    expect(create).toHaveBeenCalledTimes(1);
    const callArg = create.mock.calls[0][0] as unknown as {
      data: { webhookConfigId: string; payloadDigest: string };
    };
    expect(callArg.data.payloadDigest).toBe(expectedDigest);
    expect(callArg.data.webhookConfigId).toBe("cfg_1");
  });

  it("no-op when zero matching configs", async () => {
    const { tx, count, create } = buildFakeTx({
      configs: [],
      countByConfigId: {},
    });
    await emitWithCoalescing(
      "scim.group.member_added",
      basePayload,
      tx as never,
      {}
    );
    expect(emitMock).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("emitWithCoalescing — at-threshold summary emit", () => {
  it("emits the summary event when window count >= SCIM_COALESCING_THRESHOLD", async () => {
    const { tx } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 12 },
    });
    await emitWithCoalescing(
      "scim.group.member_added",
      basePayload,
      tx as never,
      {}
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, summaryPayload] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.group.member_added.summary");
    expect(summaryPayload).toMatchObject({
      count: 13,
      sampleIds: ["u1", "u2", "u3"],
    });
    expect((summaryPayload as { firstAt: unknown }).firstAt).toBeDefined();
    expect((summaryPayload as { lastAt: unknown }).lastAt).toBeDefined();
    expect(
      (summaryPayload as { windowStart: unknown }).windowStart
    ).toBeDefined();
  });

  it("summary digest is sha256(`${eventName}.summary:${windowStart.toISOString()}:${configId}`)", async () => {
    const fakeNow = new Date("2026-06-06T12:34:56.789Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);
    try {
      const { tx, create } = buildFakeTx({
        configs: [{ id: "cfg_42" }],
        countByConfigId: { cfg_42: 50 },
      });
      await emitWithCoalescing(
        "scim.group.member_added",
        basePayload,
        tx as never,
        {}
      );
      const WINDOW_MS = 5 * 60 * 1000;
      const windowStart = new Date(Math.floor(fakeNow / WINDOW_MS) * WINDOW_MS);
      const expectedDigest = createHash("sha256")
        .update(
          `scim.group.member_added.summary:${windowStart.toISOString()}:cfg_42`
        )
        .digest("hex");
      const callArg = create.mock.calls[0][0] as unknown as {
        data: { payloadDigest: string };
      };
      expect(callArg.data.payloadDigest).toBe(expectedDigest);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("silently skips emit when summary digest INSERT throws P2002 (concurrent emitter already fired)", async () => {
    const p2002 = new ORMError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" }
    );
    const { tx } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 50 },
      createImpl: async () => {
        throw p2002;
      },
    });
    await expect(
      emitWithCoalescing(
        "scim.group.member_added",
        basePayload,
        tx as never,
        {}
      )
    ).resolves.toBeUndefined();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("propagates non-P2002 errors from the dedup INSERT", async () => {
    const otherErr = new ORMError(
      "Foreign key constraint failed",
      { code: "P2003", clientVersion: "test" }
    );
    const { tx } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 50 },
      createImpl: async () => {
        throw otherErr;
      },
    });
    await expect(
      emitWithCoalescing(
        "scim.group.member_added",
        basePayload,
        tx as never,
        {}
      )
    ).rejects.toBe(otherErr);
  });
});

describe("emitWithCoalescing — multiple configs, mixed thresholds", () => {
  it("emits per-event for sub-threshold configs and summary for at-threshold configs", async () => {
    const { tx, create } = buildFakeTx({
      configs: [{ id: "cfg_a" }, { id: "cfg_b" }, { id: "cfg_c" }],
      countByConfigId: { cfg_a: 1, cfg_b: 25, cfg_c: 0 },
    });
    await emitWithCoalescing(
      "scim.group.member_added",
      basePayload,
      tx as never,
      {}
    );
    expect(emitMock).toHaveBeenCalledTimes(3);
    const eventNames = emitMock.mock.calls.map((c) => c[0]);
    expect(
      eventNames.filter((n) => n === "scim.group.member_added")
    ).toHaveLength(2);
    expect(
      eventNames.filter((n) => n === "scim.group.member_added.summary")
    ).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("findMany filter requires isActive: true AND subscribedEvents has eventName", async () => {
    const { tx, findMany } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 0 },
    });
    await emitWithCoalescing(
      "scim.group.created",
      basePayload,
      tx as never,
      {}
    );
    const whereArg = (findMany.mock.calls[0] as unknown[])[0] as {
      where: {
        isActive: boolean;
        subscribedEvents: { has: string };
      };
    };
    expect(whereArg.where.isActive).toBe(true);
    expect(whereArg.where.subscribedEvents).toEqual({
      has: "scim.group.created",
    });
  });

  it("threads opts.projectId and opts.actorUserId into webhookEvents.emit", async () => {
    const { tx } = buildFakeTx({
      configs: [{ id: "cfg_1" }],
      countByConfigId: { cfg_1: 0 },
    });
    await emitWithCoalescing(
      "scim.group.member_added",
      basePayload,
      tx as never,
      { projectId: 99, actorUserId: "tk_admin" }
    );
    const opts = emitMock.mock.calls[0][2];
    expect(opts).toMatchObject({
      projectId: 99,
      actorUserId: "tk_admin",
    });
  });
});

describe("emitWithCoalescing — purity + tx invariant", () => {
  it("count query uses 5-min sliding window (processedAt > now - SCIM_COALESCING_WINDOW_MS)", async () => {
    const fakeNow = new Date("2026-06-06T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);
    try {
      const { tx, count } = buildFakeTx({
        configs: [{ id: "cfg_1" }],
        countByConfigId: { cfg_1: 0 },
      });
      await emitWithCoalescing(
        "scim.group.member_added",
        basePayload,
        tx as never,
        {}
      );
      const callArg = count.mock.calls[0][0] as {
        where: {
          webhookConfigId: string;
          processedAt: { gt: Date };
        };
      };
      expect(callArg.where.webhookConfigId).toBe("cfg_1");
      const expectedWindowAgo = new Date(fakeNow - 5 * 60 * 1000);
      expect(callArg.where.processedAt.gt.getTime()).toBe(
        expectedWindowAgo.getTime()
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("acquires a per-config pg_advisory_xact_lock BEFORE the threshold count (parallel-flood serialization invariant)", async () => {
    // UAT 2026-06-09: 12 parallel POST /Users requests all read the count
    // under READ COMMITTED, each saw < threshold, all 12 emitted per-event
    // and no .summary fired. Per-config advisory lock serializes the
    // count-then-write across concurrent transactions targeting the same
    // config, so the (k+1)th caller is guaranteed to see the count k wrote.
    const callOrder: string[] = [];
    const executeRaw = vi.fn(async (..._args: unknown[]) => {
      callOrder.push("lock");
      return 1;
    });
    const count = vi.fn(async () => {
      callOrder.push("count");
      return 0;
    });
    const create = vi.fn(async () => {
      callOrder.push("create");
      return { id: "dedup_row" };
    });
    const findMany = vi.fn(async () => [
      { id: "cfg_a" },
      { id: "cfg_b" },
      { id: "cfg_c" },
    ]);
    const tx = {
      webhookConfig: { findMany },
      webhookEventDedup: { count, create },
      $executeRaw: executeRaw,
    };

    await emitWithCoalescing("scim.user.created", basePayload, tx as never, {});

    // 3 configs → 3 lock acquisitions, each before its config's count call.
    expect(executeRaw).toHaveBeenCalledTimes(3);
    expect(count).toHaveBeenCalledTimes(3);

    // Order MUST be: lock, count, create (per-event branch), repeat per
    // config. If the lock fired AFTER count for any iteration, parallel
    // tx could still race the threshold check.
    expect(callOrder).toEqual([
      "lock",
      "count",
      "create",
      "lock",
      "count",
      "create",
      "lock",
      "count",
      "create",
    ]);
  });

  it("derives a stable bigint lock key from the config id (deterministic across calls)", async () => {
    // Same configId across two calls MUST yield the same lock-key SQL
    // template parameter so concurrent emitters actually contend on the
    // same Postgres lock. (Different configIds get different keys —
    // emitters for unrelated configs proceed in parallel.)
    const seenKeys: string[] = [];
    const executeRaw = vi.fn(async (...args: unknown[]) => {
      // Prisma tagged-template $executeRaw receives the strings array as
      // the first argument and interpolations as the rest. The lock-key
      // string is one of the trailing interpolations.
      const stringifiedArgs = args
        .map((a) => (Array.isArray(a) ? a.join("|") : JSON.stringify(a)))
        .join(" ");
      seenKeys.push(stringifiedArgs);
      return 1;
    });

    const buildTx = () => ({
      webhookConfig: {
        findMany: vi.fn(async () => [{ id: "cfg_stable" }]),
      },
      webhookEventDedup: {
        count: vi.fn(async () => 0),
        create: vi.fn(async () => ({ id: "dedup_row" })),
      },
      $executeRaw: executeRaw,
    });

    await emitWithCoalescing(
      "scim.user.created",
      basePayload,
      buildTx() as never,
      {}
    );
    await emitWithCoalescing(
      "scim.user.created",
      basePayload,
      buildTx() as never,
      {}
    );

    expect(seenKeys[0]).toBe(seenKeys[1]);
  });
});
