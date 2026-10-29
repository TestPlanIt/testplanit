import { beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-29T12:00:00Z");
const ME = "user-me";
const OTHER = "user-other";

type Row = Record<string, unknown> & { id: number };

// A tiny in-memory table set standing in for baseDb. Each delegate supports
// the four calls the service uses; `where` handling covers exactly the shapes
// the service builds (equality, `in`, `gte`).
function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        const c = cond as { in?: unknown[]; gte?: Date };
        if (c.in) return c.in.includes(value);
        if (c.gte) return value instanceof Date && value >= c.gte;
      }
      return value === cond;
    });
  const delegate = (name: string) => ({
    findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
      (tables[name] ?? []).filter((row) => matches(row, args.where))
    ),
    findUnique: vi.fn(
      async (args: { where: { id?: number; key?: string } }) =>
        (tables[name] ?? []).find((row) =>
          args.where.id !== undefined
            ? row.id === args.where.id
            : row.key === args.where.key
        ) ?? null
    ),
    update: vi.fn(
      async (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        const row = (tables[name] ?? []).find((r) => r.id === args.where.id)!;
        if (name === "repositoryFolders" && args.data.isDeleted === false) {
          const clash = tables[name].some(
            (r) =>
              r.id !== row.id &&
              r.isDeleted === false &&
              r.name === (args.data.name ?? row.name) &&
              r.parentId === row.parentId
          );
          if (clash) {
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
        }
        Object.assign(row, args.data);
        return row;
      }
    ),
    updateMany: vi.fn(
      async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const hits = (tables[name] ?? []).filter((row) =>
          matches(row, args.where)
        );
        for (const row of hits) Object.assign(row, args.data);
        return { count: hits.length };
      }
    ),
  });
  const db: Record<string, ReturnType<typeof delegate>> = {};
  const handler: ProxyHandler<typeof db> = {
    get(target, prop: string) {
      if (prop === "$transaction") return undefined;
      if (!target[prop]) target[prop] = delegate(prop);
      return target[prop];
    },
  };
  return { db: new Proxy(db, handler), tables };
}

const state: { db: ReturnType<typeof makeDb> | null } = { db: null };
const access = vi.fn();
const captureAuditEvent = vi.fn();
const isUniqueConstraintError = vi.fn(
  (err: unknown) => (err as { code?: string })?.code === "P2002"
);

vi.mock("~/lib/db", () => ({
  get baseDb() {
    return state.db!.db;
  },
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
    fn(state.db!.db),
}));
vi.mock("~/lib/services/auditLog", () => ({ captureAuditEvent }));
vi.mock("~/lib/utils/errors", () => ({ isUniqueConstraintError }));
vi.mock("~/lib/services/areaPermission", () => ({
  resolveEffectiveProjectAccess: (userId: string, projectId: number) =>
    access(userId, projectId),
  hasProjectAccess: (r: { ok: boolean }) => r.ok,
  areaPermissionsFrom: (
    r: { ok: boolean; areas?: string[] },
    area: string
  ) => ({
    canAddEdit: r.ok && (r.areas ? r.areas.includes(area) : true),
  }),
}));

function seedDb(overrides: Record<string, Row[]> = {}) {
  const deletedAt = new Date(NOW.getTime() - 2 * DAY);
  state.db = makeDb({
    appConfig: [],
    projects: [
      { id: 1, name: "Alpha", isDeleted: false },
      { id: 2, name: "Gone", isDeleted: true },
    ],
    repositoryFolders: [
      { id: 10, name: "Root", projectId: 1, parentId: null, isDeleted: false },
      {
        id: 11,
        name: "Deleted folder_deleted_1700000000000",
        projectId: 1,
        parentId: 10,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
      {
        id: 12,
        name: "Sub_deleted_1700000000000",
        projectId: 1,
        parentId: 11,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
    ],
    repositoryCases: [
      {
        id: 100,
        name: "My case",
        projectId: 1,
        folderId: 10,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
      {
        id: 101,
        name: "Someone else's case",
        projectId: 1,
        folderId: 10,
        isDeleted: true,
        deletedAt,
        deletedById: OTHER,
      },
      {
        id: 102,
        name: "Old case",
        projectId: 1,
        folderId: 10,
        isDeleted: true,
        deletedAt: new Date(NOW.getTime() - 40 * DAY),
        deletedById: ME,
      },
      {
        id: 103,
        name: "Case in deleted folder",
        projectId: 1,
        folderId: 11,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
      {
        id: 104,
        name: "Case in deleted project",
        projectId: 2,
        folderId: 10,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
      {
        id: 105,
        name: "Case in sub",
        projectId: 1,
        folderId: 12,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
      {
        id: 106,
        name: "Live case",
        projectId: 1,
        folderId: 10,
        isDeleted: false,
      },
    ],
    steps: [
      { id: 1000, testCaseId: 100, isDeleted: true },
      { id: 1001, testCaseId: 100, isDeleted: false },
      { id: 1002, testCaseId: 105, isDeleted: true },
    ],
    attachments: [
      {
        id: 500,
        name: "shot.png",
        testCaseId: 100,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
      {
        id: 501,
        name: "log.txt",
        testCaseId: 106,
        isDeleted: true,
        deletedAt,
        deletedById: ME,
      },
    ],
    ...overrides,
  });
  access.mockImplementation(async () => ({ ok: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  seedDb();
});

describe("readUserTrashWindowDays", () => {
  it("defaults to 30, accepts numbers and numeric strings, floors and rejects junk", async () => {
    const { readUserTrashWindowDays } = await import("./userTrash");
    expect(await readUserTrashWindowDays()).toBe(30);
    state.db!.tables.appConfig.push({
      id: 0,
      key: "user_trash_restore_window_days",
      value: 7,
    });
    expect(await readUserTrashWindowDays()).toBe(7);
    state.db!.tables.appConfig[0].value = "14.9";
    expect(await readUserTrashWindowDays()).toBe(14);
    state.db!.tables.appConfig[0].value = 0;
    expect(await readUserTrashWindowDays()).toBe(0);
    state.db!.tables.appConfig[0].value = "nope";
    expect(await readUserTrashWindowDays()).toBe(30);
    state.db!.tables.appConfig[0].value = -3;
    expect(await readUserTrashWindowDays()).toBe(30);
  });
});

describe("listUserTrash", () => {
  it("returns only my own, in-window items in live projects with a live container", async () => {
    const { listUserTrash } = await import("./userTrash");
    const { items, windowDays } = await listUserTrash(ME, { now: NOW });
    expect(windowDays).toBe(30);
    const keys = items.map((i) => `${i.itemType}:${i.id}`).sort();
    // 101 is OTHER's, 102 is outside the window, 103/105 sit in deleted
    // folders and 500 on a deleted case (all restored with their container),
    // 104's project is deleted, 12's parent folder is deleted.
    expect(keys).toEqual([
      "Attachments:501",
      "RepositoryCases:100",
      "RepositoryFolders:11",
    ]);
    const mine = items.find((i) => i.id === "100")!;
    expect(mine).toMatchObject({
      name: "My case",
      projectName: "Alpha",
      context: "Root",
    });
    expect(new Date(mine.restorableUntil).getTime()).toBe(
      new Date(mine.deletedAt).getTime() + 30 * DAY
    );
    expect(items.find((i) => i.id === "501")).toMatchObject({
      context: "Live case",
      projectName: "Alpha",
    });
    // Folder deletion appends _deleted_<ts>; the user sees the original name.
    expect(items.find((i) => i.id === "11")!.name).toBe("Deleted folder");
  });

  it("hides items in projects where I lost edit permission on that area", async () => {
    const { listUserTrash } = await import("./userTrash");
    access.mockImplementation(async () => ({ ok: true, areas: ["TestRuns"] }));
    const { items } = await listUserTrash(ME, { now: NOW });
    expect(items).toEqual([]);
  });

  it("is empty when the window is 0", async () => {
    const { listUserTrash } = await import("./userTrash");
    state.db!.tables.appConfig.push({
      id: 0,
      key: "user_trash_restore_window_days",
      value: 0,
    });
    expect(await listUserTrash(ME, { now: NOW })).toEqual({
      windowDays: 0,
      items: [],
    });
  });

  it("walks one access ladder per project", async () => {
    const { listUserTrash } = await import("./userTrash");
    await listUserTrash(ME, { now: NOW });
    expect(access).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledWith(ME, 1);
  });
});

describe("restoreUserTrashItem", () => {
  const actor = { id: ME, isAdmin: false };

  it("restores my item plus its soft-deleted children and audits it", async () => {
    const { restoreUserTrashItem } = await import("./userTrash");
    const result = await restoreUserTrashItem({
      actor,
      itemType: "RepositoryCases",
      itemId: "100",
      now: NOW,
    });
    expect(result.restored).toEqual({ steps: 1, attachments: 1 });
    const t = state.db!.tables;
    expect(t.repositoryCases.find((r) => r.id === 100)!.isDeleted).toBe(false);
    expect(t.steps.find((r) => r.id === 1000)!.isDeleted).toBe(false);
    expect(t.attachments.find((r) => r.id === 500)!.isDeleted).toBe(false);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entityType: "RepositoryCases",
        entityId: "100",
        entityName: "My case",
        projectId: 1,
        metadata: expect.objectContaining({
          operation: "restore_from_trash",
          source: "user_trash",
        }),
      })
    );
  });

  it("restores a folder tree to the leaves: subfolders, their cases, their steps", async () => {
    const { restoreUserTrashItem } = await import("./userTrash");
    const result = await restoreUserTrashItem({
      actor,
      itemType: "RepositoryFolders",
      itemId: "11",
      now: NOW,
    });
    expect(result.restored).toEqual({
      repositoryFolders: 1,
      repositoryCases: 2,
      steps: 1,
    });
    const t = state.db!.tables;
    for (const [id, name] of [
      [11, "Deleted folder"],
      [12, "Sub"],
    ] as const) {
      expect(t.repositoryFolders.find((r) => r.id === id)).toMatchObject({
        isDeleted: false,
        name,
      });
    }
    for (const id of [103, 105]) {
      expect(t.repositoryCases.find((r) => r.id === id)!.isDeleted).toBe(false);
    }
    expect(t.steps.find((r) => r.id === 1002)!.isDeleted).toBe(false);
  });

  it.each([
    ["someone else's item", "RepositoryCases", "101", "not_owner"],
    ["an item outside the window", "RepositoryCases", "102", "expired"],
    [
      "an item whose folder is still deleted",
      "RepositoryCases",
      "103",
      "parent_deleted",
    ],
    ["an item in a deleted project", "RepositoryCases", "104", "forbidden"],
    ["an unknown type", "Comment", "1", "unknown_type"],
    ["a live item", "RepositoryFolders", "10", "not_found"],
    ["a non-numeric id", "RepositoryCases", "abc", "not_found"],
  ])("refuses %s", async (_label, itemType, itemId, code) => {
    const { restoreUserTrashItem, UserTrashRestoreError } =
      await import("./userTrash");
    await expect(
      restoreUserTrashItem({ actor, itemType, itemId, now: NOW })
    ).rejects.toMatchObject({ code });
    expect(captureAuditEvent).not.toHaveBeenCalled();
    expect(UserTrashRestoreError).toBeDefined();
  });

  it("refuses when the window is 0 and when edit permission is gone", async () => {
    const { restoreUserTrashItem } = await import("./userTrash");
    access.mockImplementation(async () => ({ ok: false }));
    await expect(
      restoreUserTrashItem({
        actor,
        itemType: "RepositoryCases",
        itemId: "100",
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    state.db!.tables.appConfig.push({
      id: 0,
      key: "user_trash_restore_window_days",
      value: 0,
    });
    await expect(
      restoreUserTrashItem({
        actor,
        itemType: "RepositoryCases",
        itemId: "100",
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "disabled" });
  });

  it("lets an ADMIN bypass ownership, window and permission — but not a deleted parent", async () => {
    const { restoreUserTrashItem } = await import("./userTrash");
    const admin = { id: "admin", isAdmin: true };
    access.mockImplementation(async () => ({ ok: false }));
    state.db!.tables.appConfig.push({
      id: 0,
      key: "user_trash_restore_window_days",
      value: 0,
    });
    await expect(
      restoreUserTrashItem({
        actor: admin,
        itemType: "RepositoryCases",
        itemId: "102",
        now: NOW,
      })
    ).resolves.toMatchObject({ projectId: 1 });
    await expect(
      restoreUserTrashItem({
        actor: admin,
        itemType: "RepositoryCases",
        itemId: "101",
        now: NOW,
      })
    ).resolves.toBeDefined();
    await expect(
      restoreUserTrashItem({
        actor: admin,
        itemType: "RepositoryCases",
        itemId: "103",
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "parent_deleted" });
  });

  it("reports a name conflict instead of failing opaquely", async () => {
    const { restoreUserTrashItem } = await import("./userTrash");
    state.db!.tables.repositoryFolders.push({
      id: 13,
      name: "Deleted folder",
      projectId: 1,
      parentId: 10,
      isDeleted: false,
    });
    await expect(
      restoreUserTrashItem({
        actor,
        itemType: "RepositoryFolders",
        itemId: "11",
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "name_conflict" });
  });
});
