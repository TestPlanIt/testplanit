import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDITED_CONFIG_MODELS,
  ENTITY_NAME_FIELDS,
  type AuditedConfigModel,
  type AuditEvent,
} from "./services/auditLog";
import {
  buildConfigAuditHooks,
  type ConfigAuditDelegate,
} from "./services/configAuditHooks";

// Intercept at the queue boundary so the real auditCreate/auditUpdate/
// auditDelete diff + entityId logic runs (mirrors lib/services/auditLog.test.ts).
const mocks = vi.hoisted(() => ({
  mockQueue: { add: vi.fn() },
  // Mutable so a test can flip suppressEntityAudit on the current frame.
  currentContext: {
    userId: "ctx-user",
    userEmail: "ctx@example.com",
    userName: "Ctx User",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
    requestId: "req-test",
  } as Record<string, unknown>,
}));
vi.mock("./queues", () => ({
  getAuditLogQueue: vi.fn(() => mocks.mockQueue),
}));
vi.mock("./auditContext", () => ({
  getAuditContext: vi.fn(() => mocks.currentContext),
  SYSTEM_ACTOR_ID: "__system__",
}));
vi.mock("./multiTenantDb", () => ({
  isMultiTenantMode: vi.fn(() => false),
  getCurrentTenantId: vi.fn(() => undefined),
}));

function lastEvent(): AuditEvent {
  const calls = mocks.mockQueue.add.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1][1] as { event: AuditEvent }).event;
}

const noopDelegate: ConfigAuditDelegate = {
  findUnique: vi.fn().mockResolvedValue(null),
};

// The app-layer config audit was decommissioned (F6): AUDITED_CONFIG_MODELS is
// intentionally empty because the Postgres CDC triggers are now the sole source
// for catalog/config/join CRUD. The factory + wiring deliberately remain a no-op
// so the behavioral tests below still exercise them — they build synthetic
// AuditedConfigModel descriptors rather than reading from the (empty) live list.
const findCfg = (
  entityType: string,
  overrides: Partial<AuditedConfigModel> = {}
): AuditedConfigModel => ({
  entityType,
  accessor: entityType.charAt(0).toLowerCase() + entityType.slice(1),
  kind: "catalog",
  ...overrides,
});

describe("admin-config audit sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mocks.currentContext.suppressEntityAudit;
  });

  // App-layer config audit decommissioned (F6): the Postgres CDC triggers are
  // now the sole source for catalog/config/join CRUD, so the driving list is
  // intentionally empty to avoid double-auditing every change. The factory and
  // its `$extends` wiring remain present (and are exercised below) as a no-op.
  describe("wiring guard", () => {
    const schema = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../schema.zmodel"),
      "utf8"
    );
    const modelNames = new Set(
      [...schema.matchAll(/^\s*model\s+(\w+)\b/gm)].map((m) => m[1])
    );
    const toAccessor = (name: string) =>
      name.charAt(0).toLowerCase() + name.slice(1);
    const validAccessors = new Set([...modelNames].map(toAccessor));

    it("is intentionally empty (app-layer config audit decommissioned for CDC)", () => {
      expect(AUDITED_CONFIG_MODELS).toEqual([]);
    });

    // Defensive: should any model be re-added (to restore a specific app-layer
    // hook), it must still name a real model with a valid accessor and name
    // field — the mistyped-accessor dead-hook guard. Empty today, so this is a
    // no-op, but it keeps the invariant in place for any future re-add.
    it.each(AUDITED_CONFIG_MODELS)(
      "$entityType: accessor maps to a real model and has a name field",
      (cfg) => {
        expect(modelNames.has(cfg.entityType)).toBe(true);
        expect(validAccessors.has(cfg.accessor)).toBe(true);
        expect(toAccessor(cfg.entityType)).toBe(cfg.accessor);
        expect(ENTITY_NAME_FIELDS[cfg.entityType]).toBeDefined();
      }
    );

    it("has unique accessors (no duplicate hook keys)", () => {
      const accessors = AUDITED_CONFIG_MODELS.map((c) => c.accessor);
      expect(new Set(accessors).size).toBe(accessors.length);
    });
  });

  describe("catalog hooks", () => {
    it("create emits CREATE with entityType, id and name", async () => {
      const hooks = buildConfigAuditHooks(findCfg("Workflows"), noopDelegate);
      await hooks.create({
        args: { data: { name: "Release" } },
        query: async () => ({ id: 7, name: "Release" }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("CREATE");
      expect(ev.entityType).toBe("Workflows");
      expect(ev.entityId).toBe("7");
      expect(ev.entityName).toBe("Release");
    });

    it("update emits UPDATE with the changed field", async () => {
      const delegate: ConfigAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ id: 7, name: "Old" }),
      };
      const hooks = buildConfigAuditHooks(findCfg("Status"), delegate);
      await hooks.update({
        args: { where: { id: 7 } },
        query: async () => ({ id: 7, name: "New" }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("UPDATE");
      expect(ev.entityType).toBe("Status");
      expect(ev.changes?.name).toEqual({ old: "Old", new: "New" });
    });

    it("update with no field change emits nothing", async () => {
      const delegate: ConfigAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ id: 7, name: "Same" }),
      };
      const hooks = buildConfigAuditHooks(findCfg("Tags"), delegate);
      await hooks.update({
        args: { where: { id: 7 } },
        query: async () => ({ id: 7, name: "Same" }),
      });
      expect(mocks.mockQueue.add).not.toHaveBeenCalled();
    });

    it("delete emits DELETE captured from the pre-mutation row", async () => {
      const delegate: ConfigAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ id: 9, name: "Gone" }),
      };
      const hooks = buildConfigAuditHooks(
        findCfg("SamlConfiguration"),
        delegate
      );
      await hooks.delete({
        args: { where: { id: 9 } },
        query: async () => ({ id: 9 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("DELETE");
      expect(ev.entityType).toBe("SamlConfiguration");
      expect(ev.entityId).toBe("9");
    });

    it("forwards projectId only for project-scoped models", async () => {
      const scoped = buildConfigAuditHooks(
        findCfg("LlmFeatureConfig", { hasProjectId: true }),
        noopDelegate
      );
      await scoped.create({
        args: {},
        query: async () => ({ id: "c1", feature: "gen", projectId: 42 }),
      });
      expect(lastEvent().projectId).toBe(42);

      vi.clearAllMocks();
      const unscoped = buildConfigAuditHooks(
        findCfg("Workflows"),
        noopDelegate
      );
      await unscoped.create({
        args: {},
        query: async () => ({ id: 1, name: "X", projectId: 99 }),
      });
      expect(lastEvent().projectId).toBeUndefined();
    });

    it("does not expose bulk hooks", () => {
      const hooks = buildConfigAuditHooks(findCfg("Workflows"), noopDelegate);
      expect(hooks.createMany).toBeUndefined();
      expect(hooks.deleteMany).toBeUndefined();
    });
  });

  describe("join hooks", () => {
    it("derives entityId from the composite key when there is no scalar id", async () => {
      const hooks = buildConfigAuditHooks(
        findCfg("GroupAssignment", { kind: "join" }),
        noopDelegate
      );
      await hooks.create({
        args: { data: { userId: "u1", groupId: 3 } },
        query: async () => ({ userId: "u1", groupId: 3 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("CREATE");
      expect(ev.entityType).toBe("GroupAssignment");
      expect(ev.entityId).toBe("u1:3");
    });

    it("createMany emits BULK_CREATE", async () => {
      const hooks = buildConfigAuditHooks(
        findCfg("ProjectStatusAssignment", {
          kind: "join",
          hasProjectId: true,
        }),
        noopDelegate
      );
      await hooks.createMany({
        args: { data: [{ statusId: 1, projectId: 5 }] },
        query: async () => ({ count: 3 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("BULK_CREATE");
      expect(ev.entityType).toBe("ProjectStatusAssignment");
      expect(ev.projectId).toBe(5);
    });

    it("deleteMany emits BULK_DELETE", async () => {
      const hooks = buildConfigAuditHooks(
        findCfg("RolePermission", { kind: "join" }),
        noopDelegate
      );
      await hooks.deleteMany({
        args: { where: { roleId: 2 } },
        query: async () => ({ count: 4 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("BULK_DELETE");
      expect(ev.entityType).toBe("RolePermission");
    });
  });

  // When the ZenStack RPC route sets suppressEntityAudit (it audits canonically
  // via its own shim), the hook's generic emission must no-op so the entity is
  // not double-logged with a partial row.
  describe("suppressEntityAudit", () => {
    it("no-ops create/update/delete/bulk when the flag is set", async () => {
      mocks.currentContext.suppressEntityAudit = true;
      const catalog = buildConfigAuditHooks(findCfg("Workflows"), {
        findUnique: vi.fn().mockResolvedValue({ id: 7, name: "Old" }),
      });
      await catalog.create({
        args: {},
        query: async () => ({ id: 7, name: "X" }),
      });
      await catalog.update({
        args: { where: { id: 7 } },
        query: async () => ({ id: 7, name: "New" }),
      });
      await catalog.delete({
        args: { where: { id: 7 } },
        query: async () => ({ id: 7 }),
      });
      const join = buildConfigAuditHooks(
        findCfg("RolePermission", { kind: "join" }),
        noopDelegate
      );
      await join.createMany({ args: {}, query: async () => ({ count: 3 }) });
      await join.deleteMany({ args: {}, query: async () => ({ count: 3 }) });
      expect(mocks.mockQueue.add).not.toHaveBeenCalled();
    });

    it("still returns the query result while suppressed", async () => {
      mocks.currentContext.suppressEntityAudit = true;
      const hooks = buildConfigAuditHooks(findCfg("Workflows"), noopDelegate);
      const result = await hooks.create({
        args: {},
        query: async () => ({ id: 42, name: "X" }),
      });
      expect(result).toEqual({ id: 42, name: "X" });
    });
  });
});
