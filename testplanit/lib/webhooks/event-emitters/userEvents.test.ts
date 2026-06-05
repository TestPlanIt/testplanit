import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * userEvents emitter contract.
 *
 * Catalog: scim.user.created / scim.user.updated / scim.user.activated /
 * scim.user.deactivated / scim.user.deleted.
 *
 * The updated emitter discriminates on the isActive flip:
 *   - false -> true emits "scim.user.activated"
 *   - true  -> false emits "scim.user.deactivated"
 *   - otherwise emits "scim.user.updated"
 *
 * Empty diff suppresses emission entirely (no-op PUT idempotency).
 * Every emit threads `tx` through to webhookEvents.emit per the v0.23.0
 * in-transaction contract.
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_1",
    })),
  },
}));

vi.mock("~/lib/webhooks/diff", () => ({
  computeObjectDiff: vi.fn(),
}));

import { computeObjectDiff } from "~/lib/webhooks/diff";
import { webhookEvents } from "~/lib/webhooks/events";

import {
  determineScimUserUpdateEventName,
  emitScimUserCreated,
  emitScimUserDeleted,
  emitScimUserUpdated,
} from "./userEvents";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;
const diffMock = computeObjectDiff as unknown as ReturnType<typeof vi.fn>;

const fakeTx = { __brand: "fake-tx" } as never;

const baseSnapshot = {
  id: "user_1",
  email: "alice@example.com",
  name: "Alice Smith",
  scimUserName: "alice@example.com",
  scimExternalId: "okta_123",
  isActive: true,
  createdAt: new Date("2026-06-05T00:00:00Z"),
};

describe("emitScimUserCreated", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.user.created with payload + opts.tx + system defaults", async () => {
    await emitScimUserCreated(baseSnapshot, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.user.created");
    expect(payload).toMatchObject({
      id: "user_1",
      projectId: -1,
      scimExternalId: "okta_123",
      userName: "alice@example.com",
      email: "alice@example.com",
      active: true,
      name: "Alice Smith",
      createdAt: baseSnapshot.createdAt,
    });
    expect(opts).toMatchObject({
      tx: fakeTx,
      projectId: -1,
      actorUserId: "system-scim-user",
    });
  });

  it("honors opts.projectId override", async () => {
    await emitScimUserCreated(baseSnapshot, fakeTx, { projectId: 42 });
    const [, payload, opts] = emitMock.mock.calls[0];
    expect((payload as { projectId: number }).projectId).toBe(42);
    expect(opts.projectId).toBe(42);
  });

  it("honors opts.actorUserId override", async () => {
    await emitScimUserCreated(baseSnapshot, fakeTx, {
      actorUserId: "tk_admin",
    });
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts.actorUserId).toBe("tk_admin");
  });
});

describe("emitScimUserUpdated discriminator", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.user.activated when isActive flips false -> true", async () => {
    diffMock.mockReturnValue({
      changedFields: ["isActive"],
      before: { isActive: false },
      after: { isActive: true },
    });
    const oldRow = { ...baseSnapshot, isActive: false };
    const newRow = { ...baseSnapshot, isActive: true };
    await emitScimUserUpdated(oldRow, newRow, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("scim.user.activated");
  });

  it("emits scim.user.deactivated when isActive flips true -> false", async () => {
    diffMock.mockReturnValue({
      changedFields: ["isActive"],
      before: { isActive: true },
      after: { isActive: false },
    });
    const oldRow = { ...baseSnapshot, isActive: true };
    const newRow = { ...baseSnapshot, isActive: false };
    await emitScimUserUpdated(oldRow, newRow, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("scim.user.deactivated");
  });

  it("emits scim.user.updated when isActive does not flip (other attr changed)", async () => {
    diffMock.mockReturnValue({
      changedFields: ["scimUserName"],
      before: { scimUserName: "old" },
      after: { scimUserName: "new" },
    });
    const oldRow = { ...baseSnapshot, scimUserName: "old" };
    const newRow = { ...baseSnapshot, scimUserName: "new" };
    await emitScimUserUpdated(oldRow, newRow, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("scim.user.updated");
  });

  it("returns early without emitting when oldRow is null", async () => {
    await emitScimUserUpdated(null, baseSnapshot, fakeTx);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("returns early without emitting when computeObjectDiff is empty", async () => {
    diffMock.mockReturnValue({ changedFields: [], before: {}, after: {} });
    await emitScimUserUpdated(baseSnapshot, baseSnapshot, fakeTx);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("payload includes after and diff fields", async () => {
    const diff = {
      changedFields: ["scimUserName"],
      before: { scimUserName: "old" },
      after: { scimUserName: "new" },
    };
    diffMock.mockReturnValue(diff);
    const newRow = { ...baseSnapshot, scimUserName: "new" };
    await emitScimUserUpdated(
      { ...baseSnapshot, scimUserName: "old" },
      newRow,
      fakeTx
    );
    const [, payload] = emitMock.mock.calls[0];
    expect(payload).toMatchObject({
      id: newRow.id,
      projectId: -1,
      scimExternalId: newRow.scimExternalId,
      userName: newRow.scimUserName,
      email: newRow.email,
      after: newRow,
      diff,
    });
  });
});

describe("emitScimUserDeleted", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.user.deleted with minimal payload and system defaults", async () => {
    await emitScimUserDeleted(baseSnapshot, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.user.deleted");
    expect(payload).toMatchObject({
      id: "user_1",
      scimExternalId: "okta_123",
      projectId: -1,
    });
    expect(opts).toMatchObject({
      tx: fakeTx,
      projectId: -1,
      actorUserId: "system-scim-user",
    });
  });
});

describe("tx-required across every emitter", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("threads tx through to webhookEvents.emit on every emit call", async () => {
    diffMock.mockReturnValue({
      changedFields: ["isActive"],
      before: { isActive: false },
      after: { isActive: true },
    });

    await emitScimUserCreated(baseSnapshot, fakeTx);
    await emitScimUserUpdated(
      { ...baseSnapshot, isActive: false },
      { ...baseSnapshot, isActive: true },
      fakeTx
    );
    await emitScimUserDeleted(baseSnapshot, fakeTx);

    expect(emitMock).toHaveBeenCalledTimes(3);
    for (const call of emitMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ tx: fakeTx }));
    }
  });
});

describe("determineScimUserUpdateEventName", () => {
  it("returns scim.user.activated when isActive flips false -> true", () => {
    expect(
      determineScimUserUpdateEventName({ isActive: false }, { isActive: true })
    ).toBe("scim.user.activated");
  });

  it("returns scim.user.deactivated when isActive flips true -> false", () => {
    expect(
      determineScimUserUpdateEventName({ isActive: true }, { isActive: false })
    ).toBe("scim.user.deactivated");
  });

  it("returns scim.user.updated when both true (no flip)", () => {
    expect(
      determineScimUserUpdateEventName({ isActive: true }, { isActive: true })
    ).toBe("scim.user.updated");
  });

  it("returns scim.user.updated when both false (no flip)", () => {
    expect(
      determineScimUserUpdateEventName({ isActive: false }, { isActive: false })
    ).toBe("scim.user.updated");
  });
});
