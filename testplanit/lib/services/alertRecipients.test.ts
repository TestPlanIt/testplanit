import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectEffectiveMemberIds } = vi.hoisted(() => ({
  getProjectEffectiveMemberIds: vi.fn(async (_projectId: number) => [
    "u1",
    "u2",
  ]),
}));

vi.mock("~/lib/services/projectMembers", () => ({
  getProjectEffectiveMemberIds: (...a: unknown[]) =>
    getProjectEffectiveMemberIds(...(a as [number])),
}));

import { resolveAlertRecipients } from "./alertRecipients";

function db(
  subscribers: string[],
  users: Array<{ id: string; access: string }>
) {
  return {
    alertSubscriber: {
      findMany: vi.fn(async () => subscribers.map((userId) => ({ userId }))),
    },
    user: {
      findMany: vi.fn(async (args: any) =>
        users.filter((u) => args.where.id.in.includes(u.id))
      ),
    },
  };
}

describe("resolveAlertRecipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns nothing for a rule nobody follows, without walking membership", async () => {
    const client = db([], []);
    expect(await resolveAlertRecipients(client, 1, 7)).toEqual([]);
    expect(getProjectEffectiveMemberIds).not.toHaveBeenCalled();
  });

  it("reaches only the administrators among a system alert's subscribers", async () => {
    const client = db(
      ["u1", "admin"],
      [
        { id: "u1", access: "USER" },
        { id: "admin", access: "ADMIN" },
      ]
    );
    expect(await resolveAlertRecipients(client, 1, null)).toEqual(["admin"]);
    expect(getProjectEffectiveMemberIds).not.toHaveBeenCalled();
  });

  it("keeps subscribers who are active members or admins, drops the rest", async () => {
    const client = db(
      ["u1", "u2", "u3", "admin", "gone"],
      [
        { id: "u1", access: "USER" },
        { id: "u3", access: "USER" }, // not a member
        { id: "admin", access: "ADMIN" },
        // u2 is inactive: the user query filters it out
      ]
    );
    expect(await resolveAlertRecipients(client, 1, 7)).toEqual(["u1", "admin"]);
    expect(client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          isDeleted: false,
          access: { not: "NONE" },
        }),
      })
    );
  });
});
