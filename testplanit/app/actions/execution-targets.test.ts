import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/execution/auth", () => ({
  canManageExecutionTargets: vi.fn(),
}));

vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    executionTarget: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    codeRepository: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

// The real helper AES-encrypts with the app master key. The stand-in is a
// deterministic digest so the tests can both predict the stored value and
// assert the plaintext does not survive into it.
const { fakeEncrypt } = vi.hoisted(() => ({
  fakeEncrypt: (text: string) =>
    `enc:${createHash("sha256").update(text).digest("hex")}`,
}));

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn(async (text: string) => fakeEncrypt(text)),
  decrypt: vi.fn(async (text: string) => text),
}));

vi.mock("~/lib/execution/adapters", () => ({
  createCiDispatchAdapter: vi.fn(),
  REPOSITORY_PROVIDER_FOR: { GITHUB_ACTIONS: "GITHUB", GITLAB_CI: "GITLAB" },
}));

vi.mock("~/lib/integrations/adapters/GitRepoAdapter", () => ({
  createGitRepoAdapter: vi.fn(),
}));

vi.mock("~/lib/integrations/credentials", () => ({
  resolveStoredCredentials: vi.fn(async () => ({ personalAccessToken: "pat" })),
}));

vi.mock("~/lib/execution/service", () => ({
  resolveTargetCredentials: vi.fn(async () => ({ personalAccessToken: "pat" })),
  sanitizeExecutionError: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : "Unknown error"
  ),
}));

vi.mock("~/lib/execution/http", () => ({
  assertOutboundUrlAllowed: vi.fn(),
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { createCiDispatchAdapter } from "~/lib/execution/adapters";
import { canManageExecutionTargets } from "~/lib/execution/auth";
import { resolveTargetCredentials } from "~/lib/execution/service";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { encrypt } from "~/utils/encryption";
import { getServerAuthSession } from "~/server/auth";
import {
  createExecutionTarget,
  deleteExecutionTarget,
  getRepositoryDispatchOptions,
  listExecutionTargetChoices,
  listExecutionTargets,
  setExecutionTargetEnabled,
  updateExecutionTarget,
  verifyExecutionTarget,
} from "./execution-targets";

const mockedSession = vi.mocked(getServerAuthSession);
const mockedCanManage = vi.mocked(canManageExecutionTargets);
const mockedCanEdit = vi.mocked(userCanAddEditArea);
const mockedEncrypt = vi.mocked(encrypt);
const mockedCreateDispatchAdapter = vi.mocked(createCiDispatchAdapter);
const mockedCreateGitAdapter = vi.mocked(createGitRepoAdapter);
const mockedResolveTargetCredentials = vi.mocked(resolveTargetCredentials);
const mockedAudit = vi.mocked(captureAuditEvent);
const findFirst = vi.mocked(baseDb.executionTarget.findFirst) as any;
const findMany = vi.mocked(baseDb.executionTarget.findMany) as any;
const createTarget = vi.mocked(baseDb.executionTarget.create) as any;
const updateTarget = vi.mocked(baseDb.executionTarget.update) as any;
const findRepo = vi.mocked(baseDb.codeRepository.findFirst) as any;

const PROJECT_ID = 7;
const TARGET_ID = 31;
const REPO_ID = 5;

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    projectId: PROJECT_ID,
    name: "Nightly",
    provider: "GENERIC_WEBHOOK",
    workflowRef: null,
    defaultRef: "main",
    url: "https://ci.example.com/hooks/tpi",
    staticInputs: { suite: "smoke" },
    timeoutMinutes: 120,
    isEnabled: true,
    credentials: { encrypted: fakeEncrypt('{"secret":"old"}') },
    lastVerifiedAt: null,
    lastVerifyError: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    codeRepository: null,
    ...overrides,
  };
}

/**
 * `nameTaken` shares `executionTarget.findFirst` with the row lookups; it is
 * the only caller that filters on `name`, so route by that.
 */
function mockTargetLookup(row: unknown, nameIsTaken = false) {
  findFirst.mockImplementation((args: any) =>
    Promise.resolve(
      args?.where?.name ? (nameIsTaken ? { id: 999 } : null) : row
    )
  );
}

function asManager(id = "manager-1") {
  mockedSession.mockResolvedValue({
    user: { id, name: "Manager", email: "m@example.com", access: "USER" },
  } as any);
  mockedCanManage.mockResolvedValue(true);
}

function asNonManager(id = "viewer-1") {
  mockedSession.mockResolvedValue({
    user: { id, name: "Viewer", email: "v@example.com", access: "USER" },
  } as any);
  mockedCanManage.mockResolvedValue(false);
}

describe("execution-targets actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedEncrypt.mockImplementation(async (text: string) => fakeEncrypt(text));
    mockedResolveTargetCredentials.mockResolvedValue({
      personalAccessToken: "pat",
    } as any);
    mockTargetLookup(targetRow());
    createTarget.mockResolvedValue(targetRow());
    updateTarget.mockResolvedValue(targetRow());
    findMany.mockResolvedValue([]);
  });

  describe("manager gate", () => {
    it("refuses every manager action for a non-manager without reading or writing", async () => {
      asNonManager();

      const results = await Promise.all([
        listExecutionTargets(PROJECT_ID),
        createExecutionTarget(PROJECT_ID, {
          name: "New",
          provider: "GENERIC_WEBHOOK",
          url: "https://ci.example.com/hooks/tpi",
        }),
        updateExecutionTarget(TARGET_ID, { name: "Renamed" }),
        setExecutionTargetEnabled(TARGET_ID, false),
        deleteExecutionTarget(TARGET_ID),
        verifyExecutionTarget(TARGET_ID),
        getRepositoryDispatchOptions(PROJECT_ID, REPO_ID),
      ]);

      for (const result of results) {
        expect(result).toEqual({ success: false, error: "Forbidden" });
      }
      expect(createTarget).not.toHaveBeenCalled();
      expect(updateTarget).not.toHaveBeenCalled();
      expect(findRepo).not.toHaveBeenCalled();
      expect(mockedCreateDispatchAdapter).not.toHaveBeenCalled();
      expect(mockedAudit).not.toHaveBeenCalled();
    });

    it("refuses every manager action when there is no session", async () => {
      mockedSession.mockResolvedValue(null as any);

      const results = await Promise.all([
        createExecutionTarget(PROJECT_ID, {
          name: "New",
          provider: "GENERIC_WEBHOOK",
          url: "https://ci.example.com/hooks/tpi",
        }),
        updateExecutionTarget(TARGET_ID, { name: "Renamed" }),
        setExecutionTargetEnabled(TARGET_ID, false),
        deleteExecutionTarget(TARGET_ID),
        verifyExecutionTarget(TARGET_ID),
        getRepositoryDispatchOptions(PROJECT_ID, REPO_ID),
      ]);

      for (const result of results) {
        expect(result).toEqual({ success: false, error: "Unauthorized" });
      }
      expect(mockedCanManage).not.toHaveBeenCalled();
      expect(createTarget).not.toHaveBeenCalled();
      expect(updateTarget).not.toHaveBeenCalled();
    });
  });

  describe("createExecutionTarget", () => {
    it("mints a signing secret, stores it encrypted, and reveals the plaintext exactly once", async () => {
      asManager();
      createTarget.mockImplementation(async (args: any) =>
        targetRow({ credentials: args.data.credentials })
      );

      const result = await createExecutionTarget(PROJECT_ID, {
        name: "Nightly",
        provider: "GENERIC_WEBHOOK",
        url: "https://ci.example.com/hooks/tpi",
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const secret = result.revealedSecret;
      expect(secret).toMatch(/^[0-9a-f]{64}$/);

      const data = createTarget.mock.calls[0][0].data;
      expect(data.credentials).toEqual({
        encrypted: fakeEncrypt(JSON.stringify({ secret })),
      });
      expect(JSON.stringify(data)).not.toContain(secret);
      expect(mockedEncrypt).toHaveBeenCalledWith(JSON.stringify({ secret }));

      // The view the UI keeps only says a credential exists.
      expect(result.target.hasOwnCredentials).toBe(true);
      expect(JSON.stringify(result.target)).not.toContain(secret);
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREATE",
          entityType: "ExecutionTarget",
        })
      );
    });

    it("encrypts a CI credential and never writes it in the clear", async () => {
      asManager();
      findRepo.mockResolvedValue({ id: REPO_ID, provider: "GITHUB" });
      createTarget.mockImplementation(async (args: any) =>
        targetRow({
          provider: "GITHUB_ACTIONS",
          credentials: args.data.credentials,
          codeRepository: { id: REPO_ID, name: "acme/web", provider: "GITHUB" },
        })
      );

      const result = await createExecutionTarget(PROJECT_ID, {
        name: "CI",
        provider: "GITHUB_ACTIONS",
        codeRepositoryId: REPO_ID,
        workflowRef: "e2e.yml",
        credentials: { personalAccessToken: "ghp_supersecret" },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.revealedSecret).toBeUndefined();
      const data = createTarget.mock.calls[0][0].data;
      expect(data.credentials.encrypted).toBe(
        fakeEncrypt(JSON.stringify({ personalAccessToken: "ghp_supersecret" }))
      );
      expect(JSON.stringify(data)).not.toContain("ghp_supersecret");
    });

    it("rejects a duplicate name before writing", async () => {
      asManager();
      mockTargetLookup(targetRow(), true);

      const result = await createExecutionTarget(PROJECT_ID, {
        name: "Nightly",
        provider: "GENERIC_WEBHOOK",
        url: "https://ci.example.com/hooks/tpi",
      });

      expect(result).toMatchObject({
        success: false,
        errorCode: "automation.settings.errors.nameTaken",
      });
      expect(createTarget).not.toHaveBeenCalled();
    });
  });

  describe("updateExecutionTarget", () => {
    it("leaves credentials untouched when no rotation is asked for", async () => {
      asManager();
      mockTargetLookup(targetRow());

      const result = await updateExecutionTarget(TARGET_ID, {
        name: "Nightly renamed",
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.revealedSecret).toBeUndefined();
      const data = updateTarget.mock.calls[0][0].data;
      expect("credentials" in data).toBe(false);
      expect(mockedEncrypt).not.toHaveBeenCalled();
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            credentialsChanged: false,
            secretRotated: false,
          }),
        })
      );
    });

    it("rotates the webhook secret only when rotateSecret is set", async () => {
      asManager();
      mockTargetLookup(targetRow());
      updateTarget.mockImplementation(async (args: any) =>
        targetRow({ credentials: args.data.credentials })
      );

      const result = await updateExecutionTarget(TARGET_ID, {
        rotateSecret: true,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const secret = result.revealedSecret;
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      const data = updateTarget.mock.calls[0][0].data;
      expect(data.credentials).toEqual({
        encrypted: fakeEncrypt(JSON.stringify({ secret })),
      });
      expect(JSON.stringify(data)).not.toContain(secret);
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            credentialsChanged: true,
            secretRotated: true,
          }),
        })
      );
    });

    it("mints a secret for a webhook target that has none yet", async () => {
      asManager();
      mockTargetLookup(targetRow({ credentials: null }));

      const result = await updateExecutionTarget(TARGET_ID, {});

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.revealedSecret).toMatch(/^[0-9a-f]{64}$/);
      expect("credentials" in updateTarget.mock.calls[0][0].data).toBe(true);
    });

    it("clears a CI credential override with an explicit null", async () => {
      asManager();
      const row = targetRow({
        provider: "GITHUB_ACTIONS",
        url: null,
        workflowRef: "e2e.yml",
        codeRepository: { id: REPO_ID, name: "acme/web", provider: "GITHUB" },
      });
      mockTargetLookup(row);
      findRepo.mockResolvedValue({ id: REPO_ID, provider: "GITHUB" });
      updateTarget.mockResolvedValue(row);

      const result = await updateExecutionTarget(TARGET_ID, {
        credentials: null,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect("credentials" in updateTarget.mock.calls[0][0].data).toBe(false);
      expect(baseDb.$executeRaw).toHaveBeenCalled();
      expect(result.target.hasOwnCredentials).toBe(false);
    });

    it("404s when the target is gone, before any permission check", async () => {
      asManager();
      mockTargetLookup(null);

      const result = await updateExecutionTarget(TARGET_ID, { name: "x" });

      expect(result).toEqual({ success: false, error: "Target not found" });
      expect(mockedCanManage).not.toHaveBeenCalled();
    });
  });

  describe("listExecutionTargetChoices", () => {
    it("returns only the sanitized fields — never url, credentials or inputs", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "runner-1", access: "USER" },
      } as any);
      mockedCanEdit.mockResolvedValue(true);
      findMany.mockResolvedValue([
        {
          id: TARGET_ID,
          name: "Nightly",
          provider: "GENERIC_WEBHOOK",
          defaultRef: "main",
          isEnabled: true,
        },
      ]);

      const result = await listExecutionTargetChoices(PROJECT_ID);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: PROJECT_ID, isDeleted: false },
          select: {
            id: true,
            name: true,
            provider: true,
            defaultRef: true,
            isEnabled: true,
          },
        })
      );
      const selected = findMany.mock.calls[0][0].select;
      for (const leaked of ["url", "credentials", "staticInputs"]) {
        expect(selected).not.toHaveProperty(leaked);
      }
      expect(Object.keys(result.targets[0]).sort()).toEqual([
        "defaultRef",
        "id",
        "isEnabled",
        "name",
        "provider",
      ]);
      // This list is open to run editors, so the manager gate is not consulted.
      expect(mockedCanManage).not.toHaveBeenCalled();
    });

    it("refuses a caller who cannot add/edit runs in the project", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "viewer-1", access: "USER" },
      } as any);
      mockedCanEdit.mockResolvedValue(false);

      const result = await listExecutionTargetChoices(PROJECT_ID);

      expect(result).toEqual({ success: false, error: "Forbidden" });
      expect(findMany).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller", async () => {
      mockedSession.mockResolvedValue(null as any);

      const result = await listExecutionTargetChoices(PROJECT_ID);

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockedCanEdit).not.toHaveBeenCalled();
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe("verifyExecutionTarget", () => {
    it("stores lastVerifyError when the adapter reports the target unusable", async () => {
      asManager();
      mockTargetLookup(targetRow({ codeRepository: null }));
      mockedCreateDispatchAdapter.mockReturnValue({
        testDispatchCapability: vi.fn(async () => ({
          ok: false,
          error: "Workflow e2e.yml not found",
          warnings: [],
        })),
      } as any);

      const result = await verifyExecutionTarget(TARGET_ID);

      expect(result).toMatchObject({
        success: true,
        capability: { ok: false, error: "Workflow e2e.yml not found" },
      });
      expect(updateTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID },
          data: expect.objectContaining({
            lastVerifyError: "Workflow e2e.yml not found",
          }),
        })
      );
      expect(updateTarget.mock.calls[0][0].data.lastVerifiedAt).toBeInstanceOf(
        Date
      );
    });

    it("stores the sanitized message when resolving the credential throws", async () => {
      asManager();
      mockTargetLookup(targetRow());
      mockedResolveTargetCredentials.mockRejectedValue(
        new Error("No credential configured")
      );

      const result = await verifyExecutionTarget(TARGET_ID);

      expect(result).toMatchObject({ success: true });
      expect(updateTarget.mock.calls[0][0].data.lastVerifyError).toBe(
        "No credential configured"
      );
      expect(mockedCreateDispatchAdapter).not.toHaveBeenCalled();
    });

    it("clears lastVerifyError on success and does not store warnings", async () => {
      asManager();
      mockTargetLookup(targetRow());
      mockedCreateDispatchAdapter.mockReturnValue({
        testDispatchCapability: vi.fn(async () => ({
          ok: true,
          warnings: ["the workflow does not declare tpi_case_ids"],
        })),
      } as any);

      const result = await verifyExecutionTarget(TARGET_ID);

      expect(result).toMatchObject({ success: true });
      expect(updateTarget.mock.calls[0][0].data.lastVerifyError).toBeNull();
    });

    it("404s when the target is gone", async () => {
      asManager();
      mockTargetLookup(null);

      const result = await verifyExecutionTarget(TARGET_ID);

      expect(result).toEqual({ success: false, error: "Target not found" });
      expect(updateTarget).not.toHaveBeenCalled();
    });
  });

  describe("getRepositoryDispatchOptions", () => {
    it("scopes the repository lookup to the project's linked configs", async () => {
      asManager();
      findRepo.mockResolvedValue({
        id: REPO_ID,
        provider: "GITHUB",
        credentials: { encrypted: "x" },
        settings: { owner: "acme" },
      });
      mockedCreateGitAdapter.mockReturnValue({
        listBranches: vi.fn(async () => [
          { name: "main", isDefault: true },
          { name: "dev", isDefault: false },
        ]),
      } as any);
      mockedCreateDispatchAdapter.mockReturnValue({
        listWorkflows: vi.fn(async () => [{ path: "e2e.yml", name: "E2E" }]),
      } as any);

      const result = await getRepositoryDispatchOptions(PROJECT_ID, REPO_ID);

      expect(findRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: REPO_ID,
            isDeleted: false,
            projectConfigs: { some: { projectId: PROJECT_ID } },
          }),
        })
      );
      expect(result).toMatchObject({
        success: true,
        branches: ["main", "dev"],
        defaultBranch: "main",
        workflows: [{ path: "e2e.yml", name: "E2E" }],
      });
    });

    it("refuses a repository that is not linked to this project and never reaches an adapter", async () => {
      asManager();
      // The scoped where-clause is what makes a cross-project repository
      // invisible here; the lookup simply returns nothing.
      findRepo.mockResolvedValue(null);

      const result = await getRepositoryDispatchOptions(PROJECT_ID, REPO_ID);

      expect(result).toEqual({
        success: false,
        error: "Code repository not found",
      });
      expect(findRepo.mock.calls[0][0].where.projectConfigs).toEqual({
        some: { projectId: PROJECT_ID },
      });
      expect(mockedCreateGitAdapter).not.toHaveBeenCalled();
      expect(mockedCreateDispatchAdapter).not.toHaveBeenCalled();
    });

    it("skips the workflow listing for a non-GitHub repository", async () => {
      asManager();
      findRepo.mockResolvedValue({
        id: REPO_ID,
        provider: "GITLAB",
        credentials: { encrypted: "x" },
        settings: null,
      });
      mockedCreateGitAdapter.mockReturnValue({
        listBranches: vi.fn(async () => [{ name: "main", isDefault: true }]),
      } as any);

      const result = await getRepositoryDispatchOptions(PROJECT_ID, REPO_ID);

      expect(result).toMatchObject({ success: true, workflows: [] });
      expect(mockedCreateDispatchAdapter).not.toHaveBeenCalled();
    });

    it("degrades to a warning when the provider call fails", async () => {
      asManager();
      findRepo.mockResolvedValue({
        id: REPO_ID,
        provider: "GITHUB",
        credentials: { encrypted: "x" },
        settings: null,
      });
      mockedCreateGitAdapter.mockReturnValue({
        listBranches: vi.fn(async () => {
          throw new Error("Bad credentials");
        }),
      } as any);

      const result = await getRepositoryDispatchOptions(PROJECT_ID, REPO_ID);

      expect(result).toMatchObject({
        success: true,
        warning: "Bad credentials",
        branches: [],
      });
    });
  });

  describe("setExecutionTargetEnabled / deleteExecutionTarget", () => {
    it("toggles isEnabled and audits the flag change", async () => {
      asManager();
      mockTargetLookup({ id: TARGET_ID, projectId: PROJECT_ID, name: "N" });
      updateTarget.mockResolvedValue(targetRow({ isEnabled: false }));

      const result = await setExecutionTargetEnabled(TARGET_ID, false);

      expect(result).toMatchObject({ success: true });
      expect(updateTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID },
          data: { isEnabled: false },
        })
      );
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: { isEnabled: { old: true, new: false } },
        })
      );
    });

    it("soft-deletes and disables rather than removing the row", async () => {
      asManager();
      mockTargetLookup({ id: TARGET_ID, projectId: PROJECT_ID, name: "N" });

      const result = await deleteExecutionTarget(TARGET_ID);

      expect(result).toEqual({ success: true });
      const data = updateTarget.mock.calls[0][0].data;
      expect(data.isDeleted).toBe(true);
      expect(data.isEnabled).toBe(false);
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "DELETE" })
      );
    });
  });
});
