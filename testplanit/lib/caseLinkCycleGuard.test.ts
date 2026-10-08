import { describe, expect, it, vi } from "vitest";
import {
  assertValidCaseLink,
  CIRCULAR_DEPENDENCY_MESSAGE,
  SELF_LINK_MESSAGE,
  type CaseLinkReader,
} from "./caseLinkCycleGuard";

type Edge = {
  caseAId: number;
  caseBId: number;
  type?: string;
  deleted?: boolean;
};

/** In-memory link table: `caseAId` depends on `caseBId`. */
function makeReader(edges: Edge[]): CaseLinkReader & {
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async ({ where }: any) =>
    edges
      .filter(
        (e) =>
          where.caseAId.in.includes(e.caseAId) &&
          (e.type ?? "DEPENDS_ON") === where.type &&
          !e.deleted
      )
      .map((e) => ({ caseAId: e.caseAId, caseBId: e.caseBId }))
  );
  const findUnique = vi.fn(async ({ where }: any) => {
    const row = edges[where.id - 1];
    return row
      ? {
          id: where.id,
          caseAId: row.caseAId,
          caseBId: row.caseBId,
          type: row.type ?? "DEPENDS_ON",
          isDeleted: !!row.deleted,
        }
      : null;
  });
  return { repositoryCaseLink: { findMany, findUnique }, findMany } as any;
}

const create = (caseAId: number, caseBId: number, type = "DEPENDS_ON") => ({
  data: {
    caseA: { connect: { id: caseAId } },
    caseB: { connect: { id: caseBId } },
    type,
    createdBy: { connect: { id: "u1" } },
  },
});

describe("assertValidCaseLink", () => {
  it("ignores other models and reads nothing", async () => {
    const reader = makeReader([]);
    await assertValidCaseLink("TestRuns", "create", create(1, 2), reader);
    expect(reader.findMany).not.toHaveBeenCalled();
  });

  it("rejects a self-link of any type", async () => {
    const reader = makeReader([]);
    await expect(
      assertValidCaseLink(
        "RepositoryCaseLink",
        "create",
        create(5, 5, "SAME_TEST_DIFFERENT_SOURCE"),
        reader
      )
    ).rejects.toThrow(SELF_LINK_MESSAGE);
  });

  it("accepts a dependency that closes no cycle", async () => {
    // 2 depends on 1; adding 3 depends on 2 is a chain.
    const reader = makeReader([{ caseAId: 2, caseBId: 1 }]);
    await expect(
      assertValidCaseLink("RepositoryCaseLink", "create", create(3, 2), reader)
    ).resolves.toBeUndefined();
  });

  it("rejects the direct reverse of an existing dependency", async () => {
    const reader = makeReader([{ caseAId: 2, caseBId: 1 }]);
    await expect(
      assertValidCaseLink("RepositoryCaseLink", "create", create(1, 2), reader)
    ).rejects.toThrow(CIRCULAR_DEPENDENCY_MESSAGE);
  });

  it("rejects a dependency that closes a longer cycle", async () => {
    // 3 → 2 → 1; adding 1 depends on 3 loops.
    const reader = makeReader([
      { caseAId: 3, caseBId: 2 },
      { caseAId: 2, caseBId: 1 },
    ]);
    await expect(
      assertValidCaseLink("RepositoryCaseLink", "create", create(1, 3), reader)
    ).rejects.toThrow(CIRCULAR_DEPENDENCY_MESSAGE);
  });

  it("walks only live DEPENDS_ON edges", async () => {
    const reader = makeReader([
      { caseAId: 2, caseBId: 1, deleted: true },
      { caseAId: 2, caseBId: 1, type: "SAME_TEST_DIFFERENT_SOURCE" },
    ]);
    await expect(
      assertValidCaseLink("RepositoryCaseLink", "create", create(1, 2), reader)
    ).resolves.toBeUndefined();
    expect(reader.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { caseAId: { in: [2] }, type: "DEPENDS_ON", isDeleted: false },
      })
    );
  });

  it("does not check cycles for non-dependency link types", async () => {
    const reader = makeReader([{ caseAId: 2, caseBId: 1 }]);
    await expect(
      assertValidCaseLink(
        "RepositoryCaseLink",
        "create",
        create(1, 2, "SAME_TEST_DIFFERENT_SOURCE"),
        reader
      )
    ).resolves.toBeUndefined();
    expect(reader.findMany).not.toHaveBeenCalled();
  });

  it("checks the create half of an upsert", async () => {
    const reader = makeReader([{ caseAId: 2, caseBId: 1 }]);
    await expect(
      assertValidCaseLink(
        "RepositoryCaseLink",
        "upsert",
        {
          where: {
            caseAId_caseBId_type: {
              caseAId: 1,
              caseBId: 2,
              type: "DEPENDS_ON",
            },
          },
          update: { isDeleted: false },
          create: create(1, 2).data,
        },
        reader
      )
    ).rejects.toThrow(CIRCULAR_DEPENDENCY_MESSAGE);
  });

  it("rejects a createMany batch that forms a cycle among its own rows", async () => {
    const reader = makeReader([]);
    await expect(
      assertValidCaseLink(
        "RepositoryCaseLink",
        "createMany",
        {
          data: [
            { caseAId: 1, caseBId: 2, type: "DEPENDS_ON", createdById: "u" },
            { caseAId: 2, caseBId: 1, type: "DEPENDS_ON", createdById: "u" },
          ],
          skipDuplicates: true,
        },
        reader
      )
    ).rejects.toThrow(CIRCULAR_DEPENDENCY_MESSAGE);
  });

  describe("update", () => {
    it("rejects restoring a soft-deleted dependency that now closes a cycle", async () => {
      // Row 1 (deleted): 1 depends on 2. Meanwhile 2 depends on 1 was added.
      const reader = makeReader([
        { caseAId: 1, caseBId: 2, deleted: true },
        { caseAId: 2, caseBId: 1 },
      ]);
      await expect(
        assertValidCaseLink(
          "RepositoryCaseLink",
          "update",
          { where: { id: 1 }, data: { isDeleted: false } },
          reader
        )
      ).rejects.toThrow(CIRCULAR_DEPENDENCY_MESSAGE);
    });

    it("lets a soft-delete through without walking the graph", async () => {
      const reader = makeReader([{ caseAId: 1, caseBId: 2 }]);
      await expect(
        assertValidCaseLink(
          "RepositoryCaseLink",
          "update",
          { where: { id: 1 }, data: { isDeleted: true } },
          reader
        )
      ).resolves.toBeUndefined();
      expect(reader.findMany).not.toHaveBeenCalled();
    });

    it("ignores an update that touches neither the edge nor deletion", async () => {
      const reader = makeReader([{ caseAId: 1, caseBId: 2 }]);
      await assertValidCaseLink(
        "RepositoryCaseLink",
        "update",
        { where: { id: 1 }, data: { createdAt: new Date() } },
        reader
      );
      expect(reader.repositoryCaseLink.findUnique).not.toHaveBeenCalled();
    });
  });
});
