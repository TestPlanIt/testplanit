import { describe, expect, it, vi } from "vitest";

import {
  claimOutboxBatch,
  fanoutToConfigs,
  type ClaimedOutboxEvent,
} from "./outbox";

/**
 * outbound webhook outbox helpers.
 *
 * claimOutboxBatch issues a Postgres CTE with FOR UPDATE SKIP LOCKED that
 * marks dispatchedAt = NOW() in the same statement. fanoutToConfigs uses
 * Prisma's text[] `has` + `isEmpty` operators. Both are unit-testable with
 * a plain db-shaped mock.
 */

const sampleClaim: ClaimedOutboxEvent = {
  id: "outbox-1",
  projectId: 7,
  eventName: "test_run.completed",
  eventId: "evt_00000000-0000-4000-8000-000000000000",
  eventTimestamp: new Date("2026-04-27T12:00:00.000Z"),
  actorUserId: "user-1",
  payload: { runId: 1 },
  dispatchedAt: new Date("2026-04-27T12:00:01.000Z"),
  createdAt: new Date("2026-04-27T11:59:00.000Z"),
};

describe("claimOutboxBatch", () => {
  it("1. calls $queryRaw with default batch size 100", async () => {
    const queryRawSpy = vi.fn().mockResolvedValue([]);
    const dbMock = { $queryRaw: queryRawSpy } as any;

    await claimOutboxBatch(dbMock);

    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    // The first call argument is the template-literal array; subsequent args
    // are the interpolated values. We expect 100 to appear in the params.
    const calledArgs = queryRawSpy.mock.calls[0];
    // Tagged-template-literal Prisma call: first arg is the strings array,
    // remaining args are the interpolated values. The batchSize is the first
    // interpolated value.
    expect(calledArgs[1]).toBe(100);
  });

  it("2. accepts an explicit batch size", async () => {
    const queryRawSpy = vi.fn().mockResolvedValue([]);
    const dbMock = { $queryRaw: queryRawSpy } as any;

    await claimOutboxBatch(dbMock, 25);

    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const calledArgs = queryRawSpy.mock.calls[0];
    expect(calledArgs[1]).toBe(25);
  });

  it("3. returns the rows the mock yields verbatim", async () => {
    const expected = [
      sampleClaim,
      { ...sampleClaim, id: "outbox-2", eventName: "issue.created" },
    ];
    const dbMock = {
      $queryRaw: vi.fn().mockResolvedValue(expected),
    } as any;

    const result = await claimOutboxBatch(dbMock);

    expect(result).toEqual(expected);
  });

  it("4. returns empty array when mock yields zero rows", async () => {
    const dbMock = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as any;

    const result = await claimOutboxBatch(dbMock);

    expect(result).toEqual([]);
  });
});

describe("fanoutToConfigs", () => {
  it("5. calls webhookConfig.findMany with OR clause containing both isEmpty:true AND has:eventName", async () => {
    const findManySpy = vi.fn().mockResolvedValue([]);
    const dbMock = {
      webhookConfig: { findMany: findManySpy },
    } as any;

    await fanoutToConfigs(
      { projectId: 7, eventName: "test_run.completed", payload: {} },
      dbMock
    );

    expect(findManySpy).toHaveBeenCalledTimes(1);
    const callArgs = findManySpy.mock.calls[0][0];
    expect(callArgs.where.OR).toContainEqual({
      subscribedEvents: { isEmpty: true },
    });
    expect(callArgs.where.OR).toContainEqual({
      subscribedEvents: { has: "test_run.completed" },
    });
  });

  it("6. filters by direction='OUTBOUND' AND isActive=true", async () => {
    const findManySpy = vi.fn().mockResolvedValue([]);
    const dbMock = {
      webhookConfig: { findMany: findManySpy },
    } as any;

    await fanoutToConfigs(
      { projectId: 7, eventName: "test_run.completed", payload: {} },
      dbMock
    );

    const callArgs = findManySpy.mock.calls[0][0];
    expect(callArgs.where.direction).toBe("OUTBOUND");
    expect(callArgs.where.isActive).toBe(true);
    expect(callArgs.where.projectId).toBe(7);
  });

  it("7. returns the IDs of the matched configs", async () => {
    const dbMock = {
      webhookConfig: {
        findMany: vi.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }]),
      },
    } as any;

    const result = await fanoutToConfigs(
      { projectId: 7, eventName: "test_run.completed", payload: {} },
      dbMock
    );

    expect(result).toEqual(["c1", "c2"]);
  });

  it("8. SQL injection defense: an event name with embedded quotes is parameterized via { has } (not interpolated)", async () => {
    const findManySpy = vi.fn().mockResolvedValue([]);
    const dbMock = {
      webhookConfig: { findMany: findManySpy },
    } as any;
    const sneaky = `evil'); DROP TABLE "WebhookConfig"; --`;

    await fanoutToConfigs(
      { projectId: 7, eventName: sneaky, payload: {} },
      dbMock
    );

    const callArgs = findManySpy.mock.calls[0][0];
    // The sneaky value MUST land in the structured `has` filter, not in any
    // string interpolation. Prisma's text[] `has` operator parameterizes the
    // value, so the SQL emitted is `<value> = ANY("subscribedEvents")` with
    // the value bound, not concatenated.
    const hasClause = callArgs.where.OR.find(
      (c: { subscribedEvents?: { has?: string } }) =>
        c.subscribedEvents?.has !== undefined
    );
    expect(hasClause.subscribedEvents.has).toBe(sneaky);
  });

  it("9. webhook.test event with payload.configId targets that specific config (bypasses subscription matching)", async () => {
    const findUniqueSpy = vi.fn().mockResolvedValue({
      id: "c-target",
      projectId: 7,
      direction: "OUTBOUND",
      isActive: true,
    });
    const findManySpy = vi.fn();
    const dbMock = {
      webhookConfig: { findUnique: findUniqueSpy, findMany: findManySpy },
    } as any;

    const result = await fanoutToConfigs(
      {
        projectId: 7,
        eventName: "webhook.test",
        payload: { configId: "c-target", source: "TestPlanIt" },
      },
      dbMock
    );

    expect(result).toEqual(["c-target"]);
    expect(findUniqueSpy).toHaveBeenCalledWith({
      where: { id: "c-target" },
      select: { id: true, projectId: true, direction: true, isActive: true },
    });
    expect(findManySpy).not.toHaveBeenCalled();
  });

  it("10. webhook.test ignores cross-project / non-OUTBOUND / inactive targets", async () => {
    const cases = [
      { id: "c-x", projectId: 99, direction: "OUTBOUND", isActive: true }, // wrong project
      { id: "c-x", projectId: 7, direction: "INBOUND", isActive: true }, // wrong direction
      { id: "c-x", projectId: 7, direction: "OUTBOUND", isActive: false }, // inactive
      null, // missing
    ];
    for (const config of cases) {
      const dbMock = {
        webhookConfig: {
          findUnique: vi.fn().mockResolvedValue(config),
          findMany: vi.fn(),
        },
      } as any;
      const result = await fanoutToConfigs(
        {
          projectId: 7,
          eventName: "webhook.test",
          payload: { configId: "c-x" },
        },
        dbMock
      );
      expect(result).toEqual([]);
    }
  });

  it("11. webhook.test with malformed/missing payload.configId returns empty", async () => {
    const dbMock = {
      webhookConfig: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    } as any;
    for (const payload of [
      null,
      undefined,
      {},
      { configId: 42 },
      [],
      "string",
    ]) {
      const result = await fanoutToConfigs(
        {
          projectId: 7,
          eventName: "webhook.test",
          payload: payload as any,
        },
        dbMock
      );
      expect(result).toEqual([]);
    }
    expect(dbMock.webhookConfig.findUnique).not.toHaveBeenCalled();
  });
});
