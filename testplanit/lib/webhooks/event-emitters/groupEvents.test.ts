import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * groupEvents emitter contract.
 *
 * Catalog: scim.group.created / scim.group.updated / scim.group.member_added /
 * scim.group.member_removed / scim.group.deleted.
 *
 * Empty diff on .updated suppresses emission (no-op PUT idempotency).
 * Empty member arrays on .member_added / .member_removed STILL emit (forensic
 * signal — IdP told us to add/remove nothing, audit + downstream should see it).
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
  emitScimGroupCreated,
  emitScimGroupDeleted,
  emitScimGroupMemberAdded,
  emitScimGroupMemberRemoved,
  emitScimGroupUpdated,
} from "./groupEvents";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;
const diffMock = computeObjectDiff as unknown as ReturnType<typeof vi.fn>;

const fakeTx = { __brand: "fake-tx" } as never;

const baseSnapshot = {
  id: 42,
  name: "Engineering",
  externalId: "okta_grp_eng",
  scimDisplayName: "engineering",
  scimExtensions: null,
  updatedAt: new Date("2026-06-05T00:00:00Z"),
  isDeleted: false,
};

describe("emitScimGroupCreated", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.group.created with payload + opts.tx + system defaults", async () => {
    await emitScimGroupCreated(
      baseSnapshot,
      [{ value: "u1" }, { value: "u2" }],
      fakeTx
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.group.created");
    expect(payload).toMatchObject({
      id: 42,
      projectId: -1,
      externalId: "okta_grp_eng",
      displayName: "Engineering",
      members: [{ value: "u1" }, { value: "u2" }],
    });
    expect((payload as { createdAt: unknown }).createdAt).toBeDefined();
    expect(opts).toMatchObject({
      tx: fakeTx,
      projectId: -1,
      actorUserId: "system-scim-user",
    });
  });

  it("honors opts.projectId override", async () => {
    await emitScimGroupCreated(baseSnapshot, [], fakeTx, { projectId: 7 });
    const [, payload, opts] = emitMock.mock.calls[0];
    expect((payload as { projectId: number }).projectId).toBe(7);
    expect(opts.projectId).toBe(7);
  });

  it("honors opts.actorUserId override", async () => {
    await emitScimGroupCreated(baseSnapshot, [], fakeTx, {
      actorUserId: "tk_admin",
    });
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts.actorUserId).toBe("tk_admin");
  });
});

describe("emitScimGroupUpdated diff + no-op suppression", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.group.updated when diff has changed fields", async () => {
    const diff = {
      changedFields: ["name"],
      before: { name: "OldName" },
      after: { name: "NewName" },
    };
    diffMock.mockReturnValue(diff);
    const oldRow = { ...baseSnapshot, name: "OldName" };
    const newRow = { ...baseSnapshot, name: "NewName" };
    await emitScimGroupUpdated(oldRow, newRow, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.group.updated");
    expect(payload).toMatchObject({
      id: 42,
      projectId: -1,
      externalId: "okta_grp_eng",
      displayName: "NewName",
      after: newRow,
      diff,
    });
  });

  it("does NOT emit when computeObjectDiff returns empty changedFields", async () => {
    diffMock.mockReturnValue({ changedFields: [], before: {}, after: {} });
    await emitScimGroupUpdated(baseSnapshot, baseSnapshot, fakeTx);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("uses computeObjectDiff from ~/lib/webhooks/diff", async () => {
    const diff = {
      changedFields: ["scimDisplayName"],
      before: { scimDisplayName: "old" },
      after: { scimDisplayName: "new" },
    };
    diffMock.mockReturnValue(diff);
    await emitScimGroupUpdated(
      { ...baseSnapshot, scimDisplayName: "old" },
      { ...baseSnapshot, scimDisplayName: "new" },
      fakeTx
    );
    expect(diffMock).toHaveBeenCalledTimes(1);
  });

  it("returns early without emitting when oldRow is null", async () => {
    await emitScimGroupUpdated(null, baseSnapshot, fakeTx);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitScimGroupMemberAdded", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.group.member_added with members shaped from the addedMemberIds array", async () => {
    await emitScimGroupMemberAdded(baseSnapshot, ["u1", "u2"], fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.group.member_added");
    expect(payload).toMatchObject({
      id: 42,
      projectId: -1,
      externalId: "okta_grp_eng",
      displayName: "Engineering",
      members: [{ value: "u1" }, { value: "u2" }],
    });
  });

  it("STILL emits when addedMemberIds is empty (forensic signal)", async () => {
    await emitScimGroupMemberAdded(baseSnapshot, [], fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [, payload] = emitMock.mock.calls[0];
    expect((payload as { members: unknown[] }).members).toEqual([]);
  });

  it("system defaults apply when opts is omitted", async () => {
    await emitScimGroupMemberAdded(baseSnapshot, ["u1"], fakeTx);
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts).toMatchObject({
      tx: fakeTx,
      projectId: -1,
      actorUserId: "system-scim-user",
    });
  });

  it("honors opts overrides for projectId and actorUserId", async () => {
    await emitScimGroupMemberAdded(baseSnapshot, ["u1"], fakeTx, {
      projectId: 99,
      actorUserId: "tk_admin",
    });
    const [, payload, opts] = emitMock.mock.calls[0];
    expect((payload as { projectId: number }).projectId).toBe(99);
    expect(opts.actorUserId).toBe("tk_admin");
  });
});

describe("emitScimGroupMemberRemoved", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.group.member_removed with members shaped from the removedMemberIds array", async () => {
    await emitScimGroupMemberRemoved(baseSnapshot, ["u1"], fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.group.member_removed");
    expect(payload).toMatchObject({
      id: 42,
      projectId: -1,
      externalId: "okta_grp_eng",
      displayName: "Engineering",
      members: [{ value: "u1" }],
    });
  });

  it("STILL emits when removedMemberIds is empty (forensic signal)", async () => {
    await emitScimGroupMemberRemoved(baseSnapshot, [], fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [, payload] = emitMock.mock.calls[0];
    expect((payload as { members: unknown[] }).members).toEqual([]);
  });

  it("system defaults apply when opts is omitted", async () => {
    await emitScimGroupMemberRemoved(baseSnapshot, ["u1"], fakeTx);
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts).toMatchObject({
      tx: fakeTx,
      projectId: -1,
      actorUserId: "system-scim-user",
    });
  });

  it("honors opts overrides for projectId and actorUserId", async () => {
    await emitScimGroupMemberRemoved(baseSnapshot, ["u1"], fakeTx, {
      projectId: 99,
      actorUserId: "tk_admin",
    });
    const [, payload, opts] = emitMock.mock.calls[0];
    expect((payload as { projectId: number }).projectId).toBe(99);
    expect(opts.actorUserId).toBe("tk_admin");
  });
});

describe("emitScimGroupDeleted", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("emits scim.group.deleted with the minimal id + externalId + projectId payload", async () => {
    await emitScimGroupDeleted(baseSnapshot, fakeTx);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("scim.group.deleted");
    expect(payload).toMatchObject({
      id: 42,
      projectId: -1,
      externalId: "okta_grp_eng",
    });
    expect(opts).toMatchObject({
      tx: fakeTx,
      projectId: -1,
      actorUserId: "system-scim-user",
    });
  });

  it("honors opts.projectId and opts.actorUserId overrides", async () => {
    await emitScimGroupDeleted(baseSnapshot, fakeTx, {
      projectId: 7,
      actorUserId: "tk_admin",
    });
    const [, payload, opts] = emitMock.mock.calls[0];
    expect((payload as { projectId: number }).projectId).toBe(7);
    expect(opts.actorUserId).toBe("tk_admin");
  });
});

describe("tx-required across every group emitter", () => {
  beforeEach(() => {
    emitMock.mockClear();
    diffMock.mockReset();
  });

  it("threads tx through to webhookEvents.emit on every emit call", async () => {
    diffMock.mockReturnValue({
      changedFields: ["name"],
      before: { name: "old" },
      after: { name: "new" },
    });

    await emitScimGroupCreated(baseSnapshot, [], fakeTx);
    await emitScimGroupUpdated(
      { ...baseSnapshot, name: "old" },
      { ...baseSnapshot, name: "new" },
      fakeTx
    );
    await emitScimGroupMemberAdded(baseSnapshot, ["u1"], fakeTx);
    await emitScimGroupMemberRemoved(baseSnapshot, ["u1"], fakeTx);
    await emitScimGroupDeleted(baseSnapshot, fakeTx);

    expect(emitMock).toHaveBeenCalledTimes(5);
    for (const call of emitMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ tx: fakeTx }));
    }
  });
});
