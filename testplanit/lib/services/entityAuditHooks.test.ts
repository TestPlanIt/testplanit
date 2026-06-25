import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDITED_CONFIG_MODELS,
  ENTITY_NAME_FIELDS,
  type AuditEvent,
} from "./auditLog";
import {
  buildEntityAuditHooks,
  ENTITY_AUDIT_MODELS,
  type EntityAuditDelegate,
} from "./entityAuditHooks";

// Intercept at the queue boundary so the real auditEntity diff + masking logic
// runs (mirrors lib/prisma.config-audit.test.ts). Paths are relative to
// lib/services/ and resolve to the same modules auditLog.ts imports via `~`.
const mocks = vi.hoisted(() => ({
  mockQueue: { add: vi.fn() },
  currentContext: {
    userId: "ctx-user",
    userEmail: "ctx@example.com",
    userName: "Ctx User",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
    requestId: "req-test",
  } as Record<string, unknown>,
}));
vi.mock("../queues", () => ({
  getAuditLogQueue: vi.fn(() => mocks.mockQueue),
}));
vi.mock("../auditContext", () => ({
  getAuditContext: vi.fn(() => mocks.currentContext),
  SYSTEM_ACTOR_ID: "__system__",
}));
vi.mock("../multiTenantDb", () => ({
  isMultiTenantMode: vi.fn(() => false),
  getCurrentTenantId: vi.fn(() => undefined),
}));

function lastEvent(): AuditEvent {
  const calls = mocks.mockQueue.add.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1][1] as { event: AuditEvent }).event;
}

// ENTITY_AUDIT_MODELS is now empty (DATA hook removal). Inline the configs that
// the behavioral tests exercise so the factory logic remains covered.
const LEGACY_CONFIGS = [
  { entityType: "Integration", accessor: "integration" },
  { entityType: "PromptConfig", accessor: "promptConfig" },
  {
    entityType: "ProjectIntegration",
    accessor: "projectIntegration",
    hasProjectId: true,
    relatedAccessor: "integration",
  },
  {
    entityType: "TestRunCases",
    accessor: "testRunCases",
    relatedAccessor: "repositoryCases",
  },
  {
    entityType: "CaseFieldValues",
    accessor: "caseFieldValues",
    relatedAccessor: "caseFields",
  },
] as const;

const cfgOf = (entityType: string) => {
  const cfg = LEGACY_CONFIGS.find((c) => c.entityType === entityType);
  if (!cfg)
    throw new Error(`missing legacy entity-audit config: ${entityType}`);
  return cfg;
};

/** A self delegate that fails the test if called — proves no self re-read. */
const forbiddenSelf: EntityAuditDelegate = {
  findUnique: vi.fn(() => {
    throw new Error("self.findUnique must not be called on this path");
  }),
};

describe("entity audit hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mocks.currentContext.suppressEntityAudit;
  });

  // A mistyped accessor is silent dead code (the $extends block is cast `as
  // any`). Validate every accessor/relatedAccessor against the schema and every
  // entityType against ENTITY_NAME_FIELDS.
  describe("wiring guard", () => {
    const schema = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../schema.zmodel"),
      "utf8"
    );
    const modelNames = new Set(
      [...schema.matchAll(/^\s*model\s+(\w+)\b/gm)].map((m) => m[1])
    );
    const toAccessor = (name: string) =>
      name.charAt(0).toLowerCase() + name.slice(1);
    const validAccessors = new Set([...modelNames].map(toAccessor));

    it.each(ENTITY_AUDIT_MODELS)(
      "$entityType: accessor maps to a real model and has a name field",
      (cfg) => {
        expect(modelNames.has(cfg.entityType)).toBe(true);
        expect(toAccessor(cfg.entityType)).toBe(cfg.accessor);
        expect(ENTITY_NAME_FIELDS[cfg.entityType]).toBeDefined();
      }
    );

    it("relatedAccessor (when set) maps to a real model and a dot-notation name", () => {
      for (const cfg of ENTITY_AUDIT_MODELS) {
        if (!cfg.relatedAccessor) continue;
        expect(validAccessors.has(cfg.relatedAccessor)).toBe(true);
        // Join models name themselves from a relation, encoded as `rel.field`.
        expect(String(ENTITY_NAME_FIELDS[cfg.entityType])).toContain(".");
      }
    });

    it("has unique accessors and never collides with AUDITED_CONFIG_MODELS", () => {
      const accessors = ENTITY_AUDIT_MODELS.map((c) => c.accessor);
      expect(new Set(accessors).size).toBe(accessors.length);
      const configAccessors = new Set(
        AUDITED_CONFIG_MODELS.map((c) => c.accessor)
      );
      expect(accessors.filter((a) => configAccessors.has(a))).toEqual([]);
    });
  });

  describe("named model (Integration)", () => {
    it("create off-RPC names from the full row and masks credentials", async () => {
      const self: EntityAuditDelegate = { findUnique: vi.fn() };
      const hooks = buildEntityAuditHooks(cfgOf("Integration"), { self });
      await hooks.create({
        args: { data: { name: "Jira Prod", provider: "JIRA" } },
        query: async () => ({
          id: 5,
          name: "Jira Prod",
          provider: "JIRA",
          credentials: "super-secret-value",
        }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("CREATE");
      expect(ev.entityType).toBe("Integration");
      expect(ev.entityId).toBe("5");
      expect(ev.entityName).toBe("Jira Prod");
      expect(ev.changes?.credentials.new).toBe("[REDACTED]");
      // Create never pre-reads the row it just wrote.
      expect(self.findUnique).not.toHaveBeenCalled();
    });

    it("create on the RPC partial { id } row names from the input", async () => {
      const hooks = buildEntityAuditHooks(cfgOf("Integration"), {
        self: { findUnique: vi.fn() },
      });
      await hooks.create({
        args: { data: { name: "GitHub", provider: "GITHUB" } },
        // ZenStack RPC injects select:{id:true} -> partial result.
        query: async () => ({ id: 8 }),
      });
      const ev = lastEvent();
      expect(ev.entityName).toBe("GitHub");
      expect(ev.changes?.provider.new).toBe("GITHUB");
    });

    it("update on the RPC partial row diffs input against the pre-read", async () => {
      const self: EntityAuditDelegate = {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 5, name: "Jira Prod", status: "ACTIVE" }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("Integration"), { self });
      await hooks.update({
        args: { where: { id: 5 }, data: { status: "DISABLED" } },
        query: async () => ({ id: 5 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("UPDATE");
      // entityName falls back to the pre-read row (input didn't change it).
      expect(ev.entityName).toBe("Jira Prod");
      expect(ev.changes?.status).toEqual({ old: "ACTIVE", new: "DISABLED" });
      expect(self.findUnique).toHaveBeenCalledTimes(1);
    });

    it("update with no effective change emits nothing", async () => {
      const hooks = buildEntityAuditHooks(cfgOf("Integration"), {
        self: {
          findUnique: vi.fn().mockResolvedValue({ id: 5, name: "Same" }),
        },
      });
      await hooks.update({
        args: { where: { id: 5 }, data: { name: "Same" } },
        query: async () => ({ id: 5 }),
      });
      expect(mocks.mockQueue.add).not.toHaveBeenCalled();
    });

    it("delete names from the pre-mutation row", async () => {
      const hooks = buildEntityAuditHooks(cfgOf("Integration"), {
        self: {
          findUnique: vi.fn().mockResolvedValue({ id: 9, name: "Gone" }),
        },
      });
      await hooks.delete({
        args: { where: { id: 9 } },
        query: async () => ({ id: 9 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("DELETE");
      expect(ev.entityId).toBe("9");
      expect(ev.entityName).toBe("Gone");
    });

    it("accepts a bare delegate (overload) for named models", async () => {
      const hooks = buildEntityAuditHooks(cfgOf("PromptConfig"), {
        findUnique: vi.fn(),
      });
      await hooks.create({
        args: { data: { name: "Summarize" } },
        query: async () => ({ id: "pc1", name: "Summarize" }),
      });
      expect(lastEvent().entityName).toBe("Summarize");
    });
  });

  describe("child model (CaseFieldValues)", () => {
    it("create resolves the field name by FK and records the value", async () => {
      const related: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ displayName: "Priority" }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("CaseFieldValues"), {
        self: forbiddenSelf,
        related,
      });
      await hooks.create({
        args: { data: { testCaseId: 12, fieldId: 3, value: "High" } },
        query: async () => ({
          id: 99,
          testCaseId: 12,
          fieldId: 3,
          value: "High",
        }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("CREATE");
      expect(ev.entityType).toBe("CaseFieldValues");
      expect(ev.entityId).toBe("99");
      expect(ev.entityName).toBe("Priority");
      expect(ev.changes?.value.new).toBe("High");
      expect(related.findUnique).toHaveBeenCalledWith({
        where: { id: 3 },
        select: { displayName: true },
      });
      // The just-created row is never re-read (invisible in-tx).
      expect(forbiddenSelf.findUnique).not.toHaveBeenCalled();
    });

    it("update on the RPC partial row diffs the value and names from the field", async () => {
      const self: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({
          id: 99,
          testCaseId: 12,
          fieldId: 3,
          value: "Low",
          field: { displayName: "Priority" },
        }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("CaseFieldValues"), {
        self,
        related: { findUnique: vi.fn() },
      });
      await hooks.update({
        args: { where: { id: 99 }, data: { value: "High" } },
        query: async () => ({ id: 99 }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("UPDATE");
      expect(ev.entityName).toBe("Priority");
      expect(ev.changes?.value).toEqual({ old: "Low", new: "High" });
      // The included `field` relation is stripped from the scalar diff.
      expect(ev.changes?.field).toBeUndefined();
      // projectId is left for the worker to backfill via the testCase parent.
      expect(ev.projectId).toBeUndefined();
    });
  });

  describe("join model (ProjectIntegration)", () => {
    it("create resolves the name from the related integration by FK", async () => {
      const related: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ name: "Jira Prod" }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("ProjectIntegration"), {
        self: forbiddenSelf,
        related,
      });
      await hooks.create({
        args: { data: { projectId: 42, integrationId: 7, isActive: true } },
        query: async () => ({
          id: "pi1",
          projectId: 42,
          integrationId: 7,
          isActive: true,
        }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("CREATE");
      expect(ev.entityName).toBe("Jira Prod");
      expect(ev.projectId).toBe(42);
      expect(related.findUnique).toHaveBeenCalledWith({
        where: { id: 7 },
        select: { name: true },
      });
      // The just-created join row is never re-read (would be invisible in-tx).
      expect(forbiddenSelf.findUnique).not.toHaveBeenCalled();
    });

    it("create resolves the FK from the RPC partial row via the input", async () => {
      const related: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ name: "GitHub" }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("ProjectIntegration"), {
        self: forbiddenSelf,
        related,
      });
      await hooks.create({
        args: { data: { projectId: 3, integrationId: 11, isActive: true } },
        query: async () => ({ id: "pi2" }),
      });
      expect(lastEvent().entityName).toBe("GitHub");
      expect(lastEvent().projectId).toBe(3);
    });

    it("create accepts the relation connect shape", async () => {
      const related: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ name: "Azure" }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("ProjectIntegration"), {
        self: forbiddenSelf,
        related,
      });
      await hooks.create({
        args: {
          data: { projectId: 1, integration: { connect: { id: 99 } } },
        },
        query: async () => ({ id: "pi3" }),
      });
      expect(related.findUnique).toHaveBeenCalledWith({
        where: { id: 99 },
        select: { name: true },
      });
      expect(lastEvent().entityName).toBe("Azure");
    });

    it("update names from the included relation and strips it from the diff", async () => {
      const self: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({
          id: "pi1",
          projectId: 42,
          integrationId: 7,
          isActive: true,
          integration: { name: "Jira Prod" },
        }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("ProjectIntegration"), {
        self,
        related: { findUnique: vi.fn() },
      });
      await hooks.update({
        args: { where: { id: "pi1" }, data: { isActive: false } },
        query: async () => ({ id: "pi1" }),
      });
      const ev = lastEvent();
      expect(ev.entityName).toBe("Jira Prod");
      expect(ev.projectId).toBe(42);
      expect(ev.changes?.isActive).toEqual({ old: true, new: false });
      // The relation object must never leak into the change set.
      expect(ev.changes?.integration).toBeUndefined();
      // Pre-read requested the name field via include.
      expect(self.findUnique).toHaveBeenCalledWith({
        where: { id: "pi1" },
        include: { integration: { select: { name: true } } },
      });
    });

    it("delete names from the included relation", async () => {
      const hooks = buildEntityAuditHooks(cfgOf("ProjectIntegration"), {
        self: {
          findUnique: vi.fn().mockResolvedValue({
            id: "pi9",
            projectId: 5,
            integrationId: 2,
            integration: { name: "Redmine" },
          }),
        },
        related: { findUnique: vi.fn() },
      });
      await hooks.delete({
        args: { where: { id: "pi9" } },
        query: async () => ({ id: "pi9" }),
      });
      const ev = lastEvent();
      expect(ev.action).toBe("DELETE");
      expect(ev.entityName).toBe("Redmine");
      expect(ev.projectId).toBe(5);
    });
  });

  describe("join model (TestRunCases)", () => {
    it("create names from the related case and forwards no projectId", async () => {
      const related: EntityAuditDelegate = {
        findUnique: vi.fn().mockResolvedValue({ name: "Login works" }),
      };
      const hooks = buildEntityAuditHooks(cfgOf("TestRunCases"), {
        self: forbiddenSelf,
        related,
      });
      await hooks.create({
        args: { data: { testRunId: 1, repositoryCaseId: 50, order: 1 } },
        query: async () => ({
          id: 99,
          testRunId: 1,
          repositoryCaseId: 50,
          order: 1,
        }),
      });
      const ev = lastEvent();
      expect(ev.entityName).toBe("Login works");
      expect(ev.projectId).toBeUndefined();
      expect(related.findUnique).toHaveBeenCalledWith({
        where: { id: 50 },
        select: { name: true },
      });
    });
  });

  // When the ZenStack RPC route sets suppressEntityAudit it audits canonically
  // via its own shim — but these four models are NOT registered there, so in
  // practice the flag is never set for them. The hooks still honor it so a
  // future registration can't double-log.
  describe("suppressEntityAudit", () => {
    it("no-ops while suppressed but still returns the query result", async () => {
      mocks.currentContext.suppressEntityAudit = true;
      const hooks = buildEntityAuditHooks(cfgOf("ProjectIntegration"), {
        self: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: "pi1", integration: { name: "X" } }),
        },
        related: { findUnique: vi.fn().mockResolvedValue({ name: "X" }) },
      });
      const created = await hooks.create({
        args: { data: { projectId: 1, integrationId: 2 } },
        query: async () => ({ id: "pi1" }),
      });
      await hooks.update({
        args: { where: { id: "pi1" }, data: { isActive: false } },
        query: async () => ({ id: "pi1" }),
      });
      await hooks.delete({
        args: { where: { id: "pi1" } },
        query: async () => ({ id: "pi1" }),
      });
      expect(mocks.mockQueue.add).not.toHaveBeenCalled();
      expect(created).toEqual({ id: "pi1" });
    });
  });
});
