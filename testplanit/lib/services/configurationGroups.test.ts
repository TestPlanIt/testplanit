import { describe, expect, it, vi } from "vitest";
import {
  assertConfigurationGroupCreateAllowed,
  assertConfigurationGroupWriteAllowed,
  CONFIGURATION_GROUP_MODELS,
  ConfigurationGroupError,
  dissolveIfSingleMember,
  dissolveOrphanedGroups,
  handleMemberDeleted,
  isConfigurationGroupError,
  isValidConfigurationGroupId,
  joinConfigurationGroup,
  leaveConfigurationGroup,
  newConfigurationGroupId,
  planDissolve,
  planJoin,
  readConfigurationGroupCreateIntents,
  readConfigurationGroupIntent,
  readTargetRecordIds,
  resolveConfigurationGroup,
  resolveConfigurationGroupModel,
  type ConfigurationGroupModel,
} from "./configurationGroups";

const GROUP_A = "11111111-1111-4111-8111-111111111111";
const GROUP_B = "22222222-2222-4222-8222-222222222222";
const MINTED = "33333333-3333-4333-8333-333333333333";

interface Row {
  id: number;
  projectId: number;
  configurationGroupId: string | null;
  isDeleted: boolean;
}

function row(id: number, overrides: Partial<Row> = {}): Row {
  return {
    id,
    projectId: 1,
    configurationGroupId: null,
    isDeleted: false,
    ...overrides,
  };
}

/**
 * Minimal in-memory stand-in for the ZenStack model delegate. Supports exactly
 * the query shapes the service issues, so the tests stay off a live database
 * while still exercising the real filters (notably `isDeleted: false`).
 */
function makeDb(model: ConfigurationGroupModel, rows: Row[]) {
  const table = rows.map((r) => ({ ...r }));
  const matches = (r: Row, where: any): boolean => {
    if (!where) return true;
    if (where.id !== undefined) {
      if (typeof where.id === "object" && Array.isArray(where.id.in)) {
        if (!where.id.in.includes(r.id)) return false;
      } else if (r.id !== where.id) {
        return false;
      }
    }
    if (
      where.configurationGroupId !== undefined &&
      r.configurationGroupId !== where.configurationGroupId
    ) {
      return false;
    }
    if (where.isDeleted !== undefined && r.isDeleted !== where.isDeleted) {
      return false;
    }
    return true;
  };
  const delegate = {
    findUnique: vi.fn(async ({ where }: any) => {
      const hit = table.find((r) => matches(r, where));
      return hit ? { ...hit } : null;
    }),
    findMany: vi.fn(async ({ where, take }: any) => {
      const hits = table
        .filter((r) => matches(r, where))
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ ...r }));
      return typeof take === "number" ? hits.slice(0, take) : hits;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const hit = table.find((r) => r.id === where.id);
      if (!hit) throw new Error(`row ${where.id} not found`);
      Object.assign(hit, data);
      return { ...hit };
    }),
  };
  return { db: { [model]: delegate } as any, table, delegate };
}

describe.each(CONFIGURATION_GROUP_MODELS)(
  "configurationGroups — %s",
  (model) => {
    describe("resolveConfigurationGroup", () => {
      it("returns the record alone when it has no group", async () => {
        const { db } = makeDb(model, [row(1)]);
        const resolved = await resolveConfigurationGroup(db, model, 1);
        expect(resolved.groupId).toBeNull();
        expect(resolved.members.map((m) => m.id)).toEqual([1]);
      });

      it("returns every live member of the group", async () => {
        const { db } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_A }),
          row(3, { configurationGroupId: GROUP_A, isDeleted: true }),
          row(4, { configurationGroupId: GROUP_B }),
        ]);
        const resolved = await resolveConfigurationGroup(db, model, 1);
        expect(resolved.groupId).toBe(GROUP_A);
        expect(resolved.members.map((m) => m.id)).toEqual([1, 2]);
      });

      it("returns a null record when the row does not exist", async () => {
        const { db } = makeDb(model, []);
        const resolved = await resolveConfigurationGroup(db, model, 99);
        expect(resolved.record).toBeNull();
        expect(resolved.members).toEqual([]);
      });
    });

    describe("join", () => {
      it("mints a uuid and stamps BOTH records when the target has no group", async () => {
        const { db, table } = makeDb(model, [row(1), row(2)]);
        const result = await joinConfigurationGroup(db, model, {
          recordId: 1,
          targetId: 2,
          mintId: () => MINTED,
        });

        expect(result.changed).toBe(true);
        expect(result.groupId).toBe(MINTED);
        expect(result.stamped.sort()).toEqual([1, 2]);
        expect(table.map((r) => r.configurationGroupId)).toEqual([
          MINTED,
          MINTED,
        ]);
      });

      it("joins an existing group without re-stamping the target", async () => {
        const { db, table, delegate } = makeDb(model, [
          row(1),
          row(2, { configurationGroupId: GROUP_A }),
          row(3, { configurationGroupId: GROUP_A }),
        ]);
        const result = await joinConfigurationGroup(db, model, {
          recordId: 1,
          targetId: 2,
        });

        expect(result.changed).toBe(true);
        expect(result.groupId).toBe(GROUP_A);
        expect(result.stamped).toEqual([1]);
        expect(table.find((r) => r.id === 1)!.configurationGroupId).toBe(
          GROUP_A
        );
        expect(delegate.update).toHaveBeenCalledTimes(1);
      });

      it("is a no-op when the record joins itself", async () => {
        const { db, delegate } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
        ]);
        const result = await joinConfigurationGroup(db, model, {
          recordId: 1,
          targetId: 1,
        });

        expect(result.changed).toBe(false);
        expect(result.groupId).toBe(GROUP_A);
        expect(delegate.update).not.toHaveBeenCalled();
      });

      it("is a no-op when the record is already in the target's group", async () => {
        const { db, delegate } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_A }),
        ]);
        const result = await joinConfigurationGroup(db, model, {
          recordId: 1,
          targetId: 2,
        });

        expect(result.changed).toBe(false);
        expect(delegate.update).not.toHaveBeenCalled();
      });

      it("rejects a cross-project join", async () => {
        const { db, delegate } = makeDb(model, [
          row(1, { projectId: 1 }),
          row(2, { projectId: 2 }),
        ]);
        await expect(
          joinConfigurationGroup(db, model, { recordId: 1, targetId: 2 })
        ).rejects.toThrow(ConfigurationGroupError);
        expect(delegate.update).not.toHaveBeenCalled();
      });

      it("auto-dissolves the group the record left when one member remains", async () => {
        const { db, table } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_A }),
          row(3, { configurationGroupId: GROUP_B }),
          row(4, { configurationGroupId: GROUP_B }),
        ]);
        const result = await joinConfigurationGroup(db, model, {
          recordId: 1,
          targetId: 3,
        });

        expect(result.groupId).toBe(GROUP_B);
        expect(result.dissolvedId).toBe(2);
        expect(table.find((r) => r.id === 2)!.configurationGroupId).toBeNull();
      });

      it("throws when either side is missing", async () => {
        const { db } = makeDb(model, [row(1)]);
        await expect(
          joinConfigurationGroup(db, model, { recordId: 1, targetId: 9 })
        ).rejects.toThrow(/not found/);
        await expect(
          joinConfigurationGroup(db, model, { recordId: 9, targetId: 1 })
        ).rejects.toThrow(/not found/);
      });
    });

    describe("leave", () => {
      it("clears the record and leaves a 3-member group intact", async () => {
        const { db, table } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_A }),
          row(3, { configurationGroupId: GROUP_A }),
        ]);
        const result = await leaveConfigurationGroup(db, model, {
          recordId: 1,
        });

        expect(result.changed).toBe(true);
        expect(result.dissolvedId).toBeNull();
        expect(table.find((r) => r.id === 1)!.configurationGroupId).toBeNull();
        expect(table.find((r) => r.id === 2)!.configurationGroupId).toBe(
          GROUP_A
        );
        expect(table.find((r) => r.id === 3)!.configurationGroupId).toBe(
          GROUP_A
        );
      });

      it("auto-dissolves the survivor when only one member would remain", async () => {
        const { db, table } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_A }),
        ]);
        const result = await leaveConfigurationGroup(db, model, {
          recordId: 1,
        });

        expect(result.dissolvedId).toBe(2);
        expect(table.every((r) => r.configurationGroupId === null)).toBe(true);
      });

      it("ignores soft-deleted rows when counting the remainder", async () => {
        const { db, table } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_A }),
          row(3, { configurationGroupId: GROUP_A, isDeleted: true }),
        ]);
        const result = await leaveConfigurationGroup(db, model, {
          recordId: 1,
        });

        expect(result.dissolvedId).toBe(2);
        expect(table.find((r) => r.id === 2)!.configurationGroupId).toBeNull();
      });

      it("is a no-op when the record has no group", async () => {
        const { db, delegate } = makeDb(model, [row(1)]);
        const result = await leaveConfigurationGroup(db, model, {
          recordId: 1,
        });
        expect(result.changed).toBe(false);
        expect(delegate.update).not.toHaveBeenCalled();
      });
    });

    describe("delete hook", () => {
      it("dissolves the survivor after a 2-member group loses one to a soft delete", async () => {
        const { db, table } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A, isDeleted: true }),
          row(2, { configurationGroupId: GROUP_A }),
        ]);
        const dissolved = await handleMemberDeleted(db, model, {
          recordId: 1,
        });

        expect(dissolved).toBe(2);
        expect(table.find((r) => r.id === 2)!.configurationGroupId).toBeNull();
      });

      it("leaves a 3-member group intact when one is soft-deleted", async () => {
        const { db, table } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A, isDeleted: true }),
          row(2, { configurationGroupId: GROUP_A }),
          row(3, { configurationGroupId: GROUP_A }),
        ]);
        const dissolved = await handleMemberDeleted(db, model, {
          recordId: 1,
        });

        expect(dissolved).toBeNull();
        expect(
          table.filter((r) => r.configurationGroupId === GROUP_A)
        ).toHaveLength(3);
      });

      it("accepts an explicit groupId for hard deletes where the row is gone", async () => {
        const { db, table } = makeDb(model, [
          row(2, { configurationGroupId: GROUP_A }),
        ]);
        const dissolved = await handleMemberDeleted(db, model, {
          recordId: 1,
          groupId: GROUP_A,
        });
        expect(dissolved).toBe(2);
        expect(table[0].configurationGroupId).toBeNull();
      });
    });

    describe("dissolve helpers", () => {
      it("dissolveIfSingleMember is a no-op for a null group", async () => {
        const { db, delegate } = makeDb(model, [row(1)]);
        expect(await dissolveIfSingleMember(db, model, null)).toBeNull();
        expect(delegate.findMany).not.toHaveBeenCalled();
      });

      it("dissolveOrphanedGroups de-duplicates and returns every survivor", async () => {
        const { db } = makeDb(model, [
          row(1, { configurationGroupId: GROUP_A }),
          row(2, { configurationGroupId: GROUP_B }),
          row(3, { configurationGroupId: GROUP_B }),
        ]);
        const dissolved = await dissolveOrphanedGroups(db, model, [
          GROUP_A,
          GROUP_A,
          GROUP_B,
          null,
          undefined,
        ]);
        expect(dissolved).toEqual([1]);
      });
    });

    describe("assertConfigurationGroupWriteAllowed", () => {
      it("allows clearing the field without any query", async () => {
        const { db, delegate } = makeDb(model, [row(1)]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: null,
            groupId: null,
          })
        ).resolves.toBeUndefined();
        expect(delegate.findMany).not.toHaveBeenCalled();
      });

      it("allows a same-project join", async () => {
        const { db } = makeDb(model, [
          row(1, { projectId: 7 }),
          row(2, { projectId: 7, configurationGroupId: GROUP_A }),
        ]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: [1],
            groupId: GROUP_A,
          })
        ).resolves.toBeUndefined();
      });

      it("rejects a cross-project join", async () => {
        const { db } = makeDb(model, [
          row(1, { projectId: 7 }),
          row(2, { projectId: 8, configurationGroupId: GROUP_A }),
        ]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: [1],
            groupId: GROUP_A,
          })
        ).rejects.toThrow(/same project/);
      });

      it("rejects a non-uuid group id", async () => {
        const { db } = makeDb(model, [row(1)]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: [1],
            groupId: "not-a-uuid",
          })
        ).rejects.toThrow(/UUID/);
      });

      it("rejects a non-null assignment with unresolvable target ids", async () => {
        const { db } = makeDb(model, [row(1)]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: null,
            groupId: GROUP_A,
          })
        ).rejects.toThrow(/specific records/);
      });

      it("allows minting a fresh group on a single record (first half of a join)", async () => {
        const { db } = makeDb(model, [row(1)]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: [1],
            groupId: MINTED,
          })
        ).resolves.toBeUndefined();
      });

      it("allows a create that mints a brand-new group", async () => {
        const { db } = makeDb(model, []);
        await expect(
          assertConfigurationGroupCreateAllowed(db, model, [
            { groupId: MINTED, projectId: 7 },
            { groupId: MINTED, projectId: 7 },
          ])
        ).resolves.toBeUndefined();
      });

      it("rejects a create that reaches into another project's group", async () => {
        const { db } = makeDb(model, [
          row(1, { projectId: 8, configurationGroupId: GROUP_A }),
          row(2, { projectId: 8, configurationGroupId: GROUP_A }),
        ]);
        await expect(
          assertConfigurationGroupCreateAllowed(db, model, [
            { groupId: GROUP_A, projectId: 7 },
          ])
        ).rejects.toThrow(/same project/);
      });

      it("rejects a create carrying a non-uuid group id", async () => {
        const { db } = makeDb(model, []);
        await expect(
          assertConfigurationGroupCreateAllowed(db, model, [
            { groupId: "nope", projectId: 7 },
          ])
        ).rejects.toThrow(/UUID/);
      });

      it("ignores the updated record itself when collecting member projects", async () => {
        // Row 1 is already in GROUP_A but sits in a different project than the
        // rest — re-asserting its own membership must not trip the check on
        // its own row.
        const { db } = makeDb(model, [
          row(1, { projectId: 7, configurationGroupId: GROUP_A }),
          row(2, { projectId: 7, configurationGroupId: GROUP_A }),
        ]);
        await expect(
          assertConfigurationGroupWriteAllowed(db, model, {
            recordIds: [1],
            groupId: GROUP_A,
          })
        ).resolves.toBeUndefined();
      });
    });
  }
);

describe("pure helpers", () => {
  it("resolveConfigurationGroupModel is case-insensitive and rejects others", () => {
    expect(resolveConfigurationGroupModel("testRuns")).toBe("testRuns");
    expect(resolveConfigurationGroupModel("TestRuns")).toBe("testRuns");
    expect(resolveConfigurationGroupModel("SESSIONS")).toBe("sessions");
    expect(resolveConfigurationGroupModel("repositoryCases")).toBeNull();
    expect(resolveConfigurationGroupModel(undefined)).toBeNull();
  });

  it("newConfigurationGroupId mints a valid uuid", () => {
    const id = newConfigurationGroupId();
    expect(isValidConfigurationGroupId(id)).toBe(true);
    expect(newConfigurationGroupId()).not.toBe(id);
  });

  it("planDissolve only fires for exactly one remaining member", () => {
    expect(planDissolve([])).toEqual([]);
    expect(planDissolve([{ id: 5 }])).toEqual([
      { id: 5, configurationGroupId: null },
    ]);
    expect(planDissolve([{ id: 5 }, { id: 6 }])).toEqual([]);
  });

  it("planJoin stamps both records when the target has no group", () => {
    const plan = planJoin(
      { id: 1, projectId: 1, configurationGroupId: null },
      { id: 2, projectId: 1, configurationGroupId: null },
      { mintId: () => MINTED }
    );
    expect(plan.noop).toBe(false);
    expect(plan.groupId).toBe(MINTED);
    expect(plan.writes).toEqual([
      { id: 1, configurationGroupId: MINTED },
      { id: 2, configurationGroupId: MINTED },
    ]);
    expect(plan.vacatedGroupId).toBeNull();
  });

  it("planJoin reports the vacated group when the record moves", () => {
    const plan = planJoin(
      { id: 1, projectId: 1, configurationGroupId: GROUP_A },
      { id: 2, projectId: 1, configurationGroupId: GROUP_B }
    );
    expect(plan.writes).toEqual([{ id: 1, configurationGroupId: GROUP_B }]);
    expect(plan.vacatedGroupId).toBe(GROUP_A);
  });

  it("planJoin refuses a cross-project pair", () => {
    expect(() =>
      planJoin(
        { id: 1, projectId: 1, configurationGroupId: null },
        { id: 2, projectId: 2, configurationGroupId: null }
      )
    ).toThrow(ConfigurationGroupError);
  });

  it("isConfigurationGroupError recognises the code on plain objects", () => {
    expect(isConfigurationGroupError(new ConfigurationGroupError("boom"))).toBe(
      true
    );
    expect(
      isConfigurationGroupError({ code: "CONFIGURATION_GROUP_INVALID" })
    ).toBe(true);
    expect(isConfigurationGroupError(new Error("nope"))).toBe(false);
  });
});

describe("readConfigurationGroupIntent", () => {
  it("returns null for payloads that touch neither the group nor deletion", () => {
    expect(
      readConfigurationGroupIntent("update", { data: { name: "renamed" } })
    ).toBeNull();
    expect(readConfigurationGroupIntent("create", { data: {} })).toBeNull();
    expect(readConfigurationGroupIntent("findMany", {})).toBeNull();
    expect(readConfigurationGroupIntent("update", null)).toBeNull();
  });

  it("reads update / updateMany from data", () => {
    expect(
      readConfigurationGroupIntent("update", {
        data: { configurationGroupId: GROUP_A },
      })
    ).toEqual({
      touchesGroup: true,
      groupId: GROUP_A,
      removesMember: false,
    });
    expect(
      readConfigurationGroupIntent("updateMany", {
        data: { configurationGroupId: null },
      })
    ).toEqual({ touchesGroup: true, groupId: null, removesMember: false });
  });

  it("reads upsert from the update branch, not the create branch", () => {
    expect(
      readConfigurationGroupIntent("upsert", {
        create: { configurationGroupId: GROUP_A },
        update: { name: "x" },
      })
    ).toBeNull();
    expect(
      readConfigurationGroupIntent("upsert", {
        create: {},
        update: { configurationGroupId: GROUP_B },
      })
    ).toEqual({
      touchesGroup: true,
      groupId: GROUP_B,
      removesMember: false,
    });
  });

  it("treats an isDeleted flip as a member removal", () => {
    expect(
      readConfigurationGroupIntent("update", { data: { isDeleted: true } })
    ).toEqual({
      touchesGroup: false,
      groupId: undefined,
      removesMember: true,
    });
    expect(
      readConfigurationGroupIntent("update", { data: { isDeleted: false } })
    ).toBeNull();
  });

  it("treats hard deletes as a member removal", () => {
    expect(
      readConfigurationGroupIntent("delete", { where: { id: 1 } })
    ).toEqual({ touchesGroup: false, groupId: undefined, removesMember: true });
  });
});

describe("readConfigurationGroupCreateIntents", () => {
  it("returns null for non-create operations and group-free creates", () => {
    expect(
      readConfigurationGroupCreateIntents("update", {
        data: { configurationGroupId: GROUP_A },
      })
    ).toBeNull();
    expect(
      readConfigurationGroupCreateIntents("create", {
        data: { name: "run" },
      })
    ).toBeNull();
  });

  it("reads a single create and a createMany batch", () => {
    expect(
      readConfigurationGroupCreateIntents("create", {
        data: { configurationGroupId: GROUP_A, projectId: 7 },
      })
    ).toEqual([{ groupId: GROUP_A, projectId: 7 }]);
    expect(
      readConfigurationGroupCreateIntents("createMany", {
        data: [
          { configurationGroupId: GROUP_A, projectId: 7 },
          { configurationGroupId: GROUP_A, project: { connect: { id: 7 } } },
          { name: "ungrouped", projectId: 7 },
        ],
      })
    ).toEqual([
      { groupId: GROUP_A, projectId: 7 },
      { groupId: GROUP_A, projectId: 7 },
    ]);
  });

  it("tolerates an unreadable projectId", () => {
    expect(
      readConfigurationGroupCreateIntents("create", {
        data: { configurationGroupId: GROUP_A },
      })
    ).toEqual([{ groupId: GROUP_A, projectId: null }]);
  });
});

describe("readTargetRecordIds", () => {
  it("reads a scalar id", () => {
    expect(readTargetRecordIds("update", { where: { id: 4 } })).toEqual([4]);
    expect(readTargetRecordIds("update", { where: { id: "4" } })).toEqual([4]);
  });

  it("reads an { in: [...] } filter for updateMany", () => {
    expect(
      readTargetRecordIds("updateMany", { where: { id: { in: [1, 2] } } })
    ).toEqual([1, 2]);
  });

  it("returns null for unresolvable shapes", () => {
    expect(readTargetRecordIds("update", { where: {} })).toBeNull();
    expect(
      readTargetRecordIds("updateMany", { where: { id: { gt: 3 } } })
    ).toBeNull();
    expect(
      readTargetRecordIds("update", { where: { id: { in: [1, 2] } } })
    ).toBeNull();
    expect(readTargetRecordIds("updateMany", { where: null })).toBeNull();
  });
});
