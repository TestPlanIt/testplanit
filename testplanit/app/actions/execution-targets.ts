"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { runWithAuditContext } from "~/lib/auditContext";
import { baseDb } from "~/lib/db";
import {
  createCiDispatchAdapter,
  REPOSITORY_PROVIDER_FOR,
} from "~/lib/execution/adapters";
import { canManageExecutionTargets } from "~/lib/execution/auth";
import { assertOutboundUrlAllowed } from "~/lib/execution/http";
import {
  describeInputError,
  normalizeInputs,
  validateCustomInputs,
} from "~/lib/execution/inputs";
import {
  resolveTargetCredentials,
  sanitizeExecutionError,
} from "~/lib/execution/service";
import type { DispatchCapability, WorkflowChoice } from "~/lib/execution/types";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { resolveStoredCredentials } from "~/lib/integrations/credentials";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { encrypt } from "~/utils/encryption";
import { ApplicationArea } from "~/zenstack/models";
import { getServerAuthSession } from "~/server/auth";

/**
 * Execution targets are written only through these actions: credentials are
 * encrypted before they touch the row, URLs are SSRF-checked, and the
 * ZenStack policy denies every direct write.
 */

const providerSchema = z.enum([
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "GENERIC_WEBHOOK",
]);

const credentialsSchema = z
  .object({
    personalAccessToken: z.string().trim().min(1).max(4096).optional(),
    triggerToken: z.string().trim().min(1).max(4096).optional(),
    secret: z.string().trim().min(8).max(4096).optional(),
  })
  .strict();

const targetInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: providerSchema,
  codeRepositoryId: z.number().int().positive().nullable().optional(),
  workflowRef: z.string().trim().max(255).nullable().optional(),
  defaultRef: z.string().trim().max(255).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  staticInputs: z.record(z.string(), z.string()).optional(),
  timeoutMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  isEnabled: z.boolean().optional(),
  /** Omit to keep, null to clear the override, object to replace. */
  credentials: credentialsSchema.nullable().optional(),
  /** GENERIC_WEBHOOK: mint a fresh signing secret (revealed once). */
  rotateSecret: z.boolean().optional(),
});

export type ExecutionTargetInput = z.infer<typeof targetInputSchema>;

export interface ExecutionTargetView {
  id: number;
  projectId: number;
  name: string;
  provider: z.infer<typeof providerSchema>;
  codeRepository: { id: number; name: string; provider: string } | null;
  workflowRef: string | null;
  defaultRef: string | null;
  url: string | null;
  staticInputs: Record<string, string>;
  timeoutMinutes: number;
  isEnabled: boolean;
  hasOwnCredentials: boolean;
  lastVerifiedAt: Date | null;
  lastVerifyError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type ActionResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string; errorCode?: string };

const targetSelect = {
  id: true,
  projectId: true,
  name: true,
  provider: true,
  workflowRef: true,
  defaultRef: true,
  url: true,
  staticInputs: true,
  timeoutMinutes: true,
  isEnabled: true,
  credentials: true,
  lastVerifiedAt: true,
  lastVerifyError: true,
  createdAt: true,
  updatedAt: true,
  codeRepository: { select: { id: true, name: true, provider: true } },
} as const;

function toView(row: {
  id: number;
  projectId: number;
  name: string;
  provider: string;
  workflowRef: string | null;
  defaultRef: string | null;
  url: string | null;
  staticInputs: unknown;
  timeoutMinutes: number;
  isEnabled: boolean;
  credentials: unknown;
  lastVerifiedAt: Date | null;
  lastVerifyError: string | null;
  createdAt: Date;
  updatedAt: Date;
  codeRepository: { id: number; name: string; provider: string } | null;
}): ExecutionTargetView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    provider: row.provider as ExecutionTargetView["provider"],
    codeRepository: row.codeRepository,
    workflowRef: row.workflowRef,
    defaultRef: row.defaultRef,
    url: row.url,
    staticInputs: normalizeInputs(row.staticInputs),
    timeoutMinutes: row.timeoutMinutes,
    isEnabled: row.isEnabled,
    hasOwnCredentials: row.credentials != null,
    lastVerifiedAt: row.lastVerifiedAt,
    lastVerifyError: row.lastVerifyError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireManager(projectId: number) {
  const session = await getServerAuthSession();
  if (!session?.user?.id)
    return { session: null, error: "Unauthorized" as const };
  const ok = await canManageExecutionTargets(session, projectId);
  if (!ok) return { session: null, error: "Forbidden" as const };
  return { session, error: null };
}

/**
 * Provider-specific shape checks. Returns an error code from the
 * `automation.settings.errors.*` namespace so the UI can localise it.
 */
async function validateShape(
  input: ExecutionTargetInput,
  projectId: number
): Promise<{ errorCode: string; error: string } | null> {
  const inputErr = validateCustomInputs(input.staticInputs);
  if (inputErr) {
    return {
      errorCode: "automation.settings.errors.invalidInputs",
      error: describeInputError(inputErr),
    };
  }
  if (input.provider === "GENERIC_WEBHOOK") {
    if (!input.url) {
      return {
        errorCode: "automation.settings.errors.urlRequired",
        error: "A webhook URL is required",
      };
    }
    try {
      assertOutboundUrlAllowed(input.url);
    } catch (err) {
      return {
        errorCode: "automation.settings.errors.urlBlocked",
        error: err instanceof Error ? err.message : "Invalid URL",
      };
    }
    return null;
  }
  const wanted = REPOSITORY_PROVIDER_FOR[input.provider];
  if (!input.codeRepositoryId) {
    return {
      errorCode: "automation.settings.errors.repositoryRequired",
      error: "A code repository is required",
    };
  }
  const repo = await baseDb.codeRepository.findFirst({
    where: { id: input.codeRepositoryId, isDeleted: false },
    select: { id: true, provider: true },
  });
  if (!repo) {
    return {
      errorCode: "automation.settings.errors.repositoryNotFound",
      error: "Code repository not found",
    };
  }
  if (repo.provider !== wanted) {
    return {
      errorCode: "automation.settings.errors.repositoryProviderMismatch",
      error: `This target needs a ${wanted} repository`,
    };
  }
  if (input.provider === "GITHUB_ACTIONS" && !input.workflowRef) {
    return {
      errorCode: "automation.settings.errors.workflowRequired",
      error: "A workflow file is required",
    };
  }
  void projectId;
  return null;
}

async function nameTaken(projectId: number, name: string, excludeId?: number) {
  const existing = await baseDb.executionTarget.findFirst({
    where: {
      projectId,
      isDeleted: false,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return existing != null;
}

async function encryptCredentials(
  creds: Record<string, string>
): Promise<{ encrypted: string }> {
  return { encrypted: await encrypt(JSON.stringify(creds)) };
}

function mintSecret(): string {
  return randomBytes(32).toString("hex");
}

export interface ExecutionTargetChoice {
  id: number;
  name: string;
  provider: z.infer<typeof providerSchema>;
  defaultRef: string | null;
  isEnabled: boolean;
}

/**
 * The sanitized list the run page and the case dialog need: anyone who can
 * add/edit runs in the project may see which targets exist. No credentials,
 * URLs or inputs leave the server.
 */
export async function listExecutionTargetChoices(
  projectId: number
): Promise<ActionResult<{ targets: ExecutionTargetChoice[] }>> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  const allowed = await userCanAddEditArea(
    session.user.id,
    projectId,
    ApplicationArea.TestRuns,
    session.user.access
  );
  if (!allowed) return { success: false, error: "Forbidden" };
  const rows = await baseDb.executionTarget.findMany({
    where: { projectId, isDeleted: false },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      provider: true,
      defaultRef: true,
      isEnabled: true,
    },
  });
  return {
    success: true,
    targets: rows.map((r) => ({
      ...r,
      provider: r.provider as ExecutionTargetChoice["provider"],
    })),
  };
}

export async function listExecutionTargets(
  projectId: number
): Promise<ActionResult<{ targets: ExecutionTargetView[] }>> {
  const gate = await requireManager(projectId);
  if (gate.error) return { success: false, error: gate.error };
  const rows = await baseDb.executionTarget.findMany({
    where: { projectId, isDeleted: false },
    orderBy: [{ name: "asc" }],
    select: targetSelect,
  });
  return { success: true, targets: rows.map(toView) };
}

export async function createExecutionTarget(
  projectId: number,
  rawInput: ExecutionTargetInput
): Promise<
  ActionResult<{ target: ExecutionTargetView; revealedSecret?: string }>
> {
  const gate = await requireManager(projectId);
  if (gate.error || !gate.session)
    return { success: false, error: gate.error ?? "Unauthorized" };
  const session = gate.session;

  const parsed = targetInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      errorCode: "automation.settings.errors.invalid",
    };
  }
  const input = parsed.data;
  const shape = await validateShape(input, projectId);
  if (shape) return { success: false, ...shape };
  if (await nameTaken(projectId, input.name)) {
    return {
      success: false,
      errorCode: "automation.settings.errors.nameTaken",
      error: "A target with this name already exists",
    };
  }

  let credentials: { encrypted: string } | null = null;
  let revealedSecret: string | undefined;
  if (input.provider === "GENERIC_WEBHOOK") {
    revealedSecret = input.credentials?.secret ?? mintSecret();
    credentials = await encryptCredentials({ secret: revealedSecret });
  } else if (input.credentials && Object.keys(input.credentials).length > 0) {
    credentials = await encryptCredentials(
      Object.fromEntries(
        Object.entries(input.credentials).filter(
          ([, v]) => typeof v === "string"
        )
      ) as Record<string, string>
    );
  }

  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    async () => {
      const row = await baseDb.executionTarget.create({
        data: {
          projectId,
          name: input.name,
          provider: input.provider,
          codeRepositoryId:
            input.provider === "GENERIC_WEBHOOK"
              ? null
              : (input.codeRepositoryId ?? null),
          workflowRef:
            input.provider === "GITHUB_ACTIONS"
              ? (input.workflowRef ?? null)
              : null,
          defaultRef:
            input.provider === "GENERIC_WEBHOOK"
              ? (input.defaultRef ?? null)
              : (input.defaultRef ?? null),
          url:
            input.provider === "GENERIC_WEBHOOK" ? (input.url ?? null) : null,
          staticInputs: normalizeInputs(input.staticInputs),
          timeoutMinutes: input.timeoutMinutes ?? 120,
          isEnabled: input.isEnabled ?? true,
          ...(credentials ? { credentials } : {}),
          createdById: session.user.id,
        },
        select: targetSelect,
      });
      await captureAuditEvent({
        action: "CREATE",
        entityType: "ExecutionTarget",
        entityId: String(row.id),
        entityName: row.name,
        projectId,
        metadata: {
          provider: row.provider,
          codeRepositoryId: row.codeRepository?.id ?? null,
        },
      });
      return { success: true, target: toView(row), revealedSecret };
    }
  );
}

export async function updateExecutionTarget(
  targetId: number,
  rawInput: Partial<ExecutionTargetInput>
): Promise<
  ActionResult<{ target: ExecutionTargetView; revealedSecret?: string }>
> {
  const existing = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    select: targetSelect,
  });
  if (!existing) return { success: false, error: "Target not found" };
  const gate = await requireManager(existing.projectId);
  if (gate.error || !gate.session)
    return { success: false, error: gate.error ?? "Unauthorized" };
  const session = gate.session;

  const parsed = targetInputSchema.partial().safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      errorCode: "automation.settings.errors.invalid",
    };
  }
  const merged: ExecutionTargetInput = {
    name: parsed.data.name ?? existing.name,
    provider: (parsed.data.provider ??
      existing.provider) as ExecutionTargetInput["provider"],
    codeRepositoryId:
      parsed.data.codeRepositoryId !== undefined
        ? parsed.data.codeRepositoryId
        : (existing.codeRepository?.id ?? null),
    workflowRef:
      parsed.data.workflowRef !== undefined
        ? parsed.data.workflowRef
        : existing.workflowRef,
    defaultRef:
      parsed.data.defaultRef !== undefined
        ? parsed.data.defaultRef
        : existing.defaultRef,
    url: parsed.data.url !== undefined ? parsed.data.url : existing.url,
    staticInputs:
      parsed.data.staticInputs !== undefined
        ? parsed.data.staticInputs
        : normalizeInputs(existing.staticInputs),
    timeoutMinutes: parsed.data.timeoutMinutes ?? existing.timeoutMinutes,
    isEnabled: parsed.data.isEnabled ?? existing.isEnabled,
    credentials: parsed.data.credentials,
    rotateSecret: parsed.data.rotateSecret,
  };
  const shape = await validateShape(merged, existing.projectId);
  if (shape) return { success: false, ...shape };
  if (await nameTaken(existing.projectId, merged.name, existing.id)) {
    return {
      success: false,
      errorCode: "automation.settings.errors.nameTaken",
      error: "A target with this name already exists",
    };
  }

  let credentialsPatch:
    { credentials: { encrypted: string } } | Record<string, never> = {};
  let clearCredentials = false;
  let revealedSecret: string | undefined;
  if (merged.provider === "GENERIC_WEBHOOK") {
    if (
      merged.rotateSecret ||
      merged.credentials?.secret ||
      existing.credentials == null
    ) {
      revealedSecret = merged.credentials?.secret ?? mintSecret();
      credentialsPatch = {
        credentials: await encryptCredentials({ secret: revealedSecret }),
      };
    }
  } else if (merged.credentials === null) {
    clearCredentials = true;
  } else if (merged.credentials && Object.keys(merged.credentials).length > 0) {
    credentialsPatch = {
      credentials: await encryptCredentials(
        Object.fromEntries(
          Object.entries(merged.credentials).filter(
            ([, v]) => typeof v === "string"
          )
        ) as Record<string, string>
      ),
    };
  }

  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    async () => {
      const row = await baseDb.executionTarget.update({
        where: { id: existing.id },
        data: {
          name: merged.name,
          provider: merged.provider,
          codeRepositoryId:
            merged.provider === "GENERIC_WEBHOOK"
              ? null
              : (merged.codeRepositoryId ?? null),
          workflowRef:
            merged.provider === "GITHUB_ACTIONS"
              ? (merged.workflowRef ?? null)
              : null,
          defaultRef: merged.defaultRef ?? null,
          url:
            merged.provider === "GENERIC_WEBHOOK" ? (merged.url ?? null) : null,
          staticInputs: normalizeInputs(merged.staticInputs),
          timeoutMinutes: merged.timeoutMinutes ?? 120,
          isEnabled: merged.isEnabled ?? true,
          // A configuration change invalidates the last verification.
          lastVerifiedAt: null,
          lastVerifyError: null,
          ...credentialsPatch,
        },
        select: targetSelect,
      });
      if (clearCredentials) {
        // Json columns cannot be nulled through the ORM's update input; the
        // override is dropped with a raw statement so the repository's
        // credential applies again.
        await baseDb.$executeRaw`UPDATE "ExecutionTarget" SET "credentials" = NULL WHERE "id" = ${existing.id}`;
      }
      const view = toView({
        ...row,
        credentials: clearCredentials ? null : row.credentials,
      });
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "ExecutionTarget",
        entityId: String(row.id),
        entityName: row.name,
        projectId: row.projectId,
        metadata: {
          provider: row.provider,
          credentialsChanged:
            "credentials" in credentialsPatch || clearCredentials,
          secretRotated: Boolean(revealedSecret),
        },
      });
      return { success: true, target: view, revealedSecret };
    }
  );
}

export async function setExecutionTargetEnabled(
  targetId: number,
  isEnabled: boolean
): Promise<ActionResult<{ target: ExecutionTargetView }>> {
  const existing = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    select: { id: true, projectId: true, name: true },
  });
  if (!existing) return { success: false, error: "Target not found" };
  const gate = await requireManager(existing.projectId);
  if (gate.error || !gate.session)
    return { success: false, error: gate.error ?? "Unauthorized" };
  const session = gate.session;
  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    async () => {
      const row = await baseDb.executionTarget.update({
        where: { id: existing.id },
        data: { isEnabled },
        select: targetSelect,
      });
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "ExecutionTarget",
        entityId: String(row.id),
        entityName: row.name,
        projectId: row.projectId,
        changes: { isEnabled: { old: !isEnabled, new: isEnabled } },
      });
      return { success: true, target: toView(row) };
    }
  );
}

export async function deleteExecutionTarget(
  targetId: number
): Promise<{ success: true } | { success: false; error: string }> {
  const existing = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    select: { id: true, projectId: true, name: true },
  });
  if (!existing) return { success: false, error: "Target not found" };
  const gate = await requireManager(existing.projectId);
  if (gate.error || !gate.session)
    return { success: false, error: gate.error ?? "Unauthorized" };
  const session = gate.session;
  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    async () => {
      await baseDb.executionTarget.update({
        where: { id: existing.id },
        data: { isDeleted: true, deletedAt: new Date(), isEnabled: false },
      });
      await captureAuditEvent({
        action: "DELETE",
        entityType: "ExecutionTarget",
        entityId: String(existing.id),
        entityName: existing.name,
        projectId: existing.projectId,
      });
      return { success: true };
    }
  );
}

/**
 * Read-only reachability check: does the credential work, does the workflow
 * exist and declare the inputs TestPlanIt sends. Stores the outcome on the
 * target so the list can show it.
 */
export async function verifyExecutionTarget(
  targetId: number
): Promise<ActionResult<{ capability: DispatchCapability }>> {
  const target = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    include: { codeRepository: true },
  });
  if (!target) return { success: false, error: "Target not found" };
  const gate = await requireManager(target.projectId);
  if (gate.error) return { success: false, error: gate.error };

  let capability: DispatchCapability;
  try {
    const credentials = await resolveTargetCredentials(
      target,
      target.codeRepository
    );
    const adapter = createCiDispatchAdapter(
      target,
      credentials,
      (target.codeRepository?.settings ?? null) as Record<string, string> | null
    );
    capability = await adapter.testDispatchCapability(target.workflowRef);
  } catch (err) {
    capability = {
      ok: false,
      error: sanitizeExecutionError(err),
      warnings: [],
    };
  }
  await baseDb.executionTarget.update({
    where: { id: target.id },
    data: {
      lastVerifiedAt: new Date(),
      // Warnings are returned to the caller for the toast but never stored:
      // lastVerifyError means "verification failed", and the list shows it
      // as such.
      lastVerifyError: capability.ok
        ? null
        : (capability.error ?? "Verification failed").slice(0, 1024),
    },
  });
  return { success: true, capability };
}

export interface RepositoryDispatchOptions {
  workflows: WorkflowChoice[];
  branches: string[];
  defaultBranch: string | null;
  warning?: string;
}

/**
 * What the target dialog needs to offer for a repository: its branches and,
 * for GitHub, its workflow files. Managers only — this reads through the
 * repository's stored credential.
 */
export async function getRepositoryDispatchOptions(
  projectId: number,
  codeRepositoryId: number
): Promise<ActionResult<RepositoryDispatchOptions>> {
  const gate = await requireManager(projectId);
  if (gate.error) return { success: false, error: gate.error };
  const repo = await baseDb.codeRepository.findFirst({
    where: { id: codeRepositoryId, isDeleted: false },
    select: { id: true, provider: true, credentials: true, settings: true },
  });
  if (!repo) return { success: false, error: "Code repository not found" };

  const result: RepositoryDispatchOptions = {
    workflows: [],
    branches: [],
    defaultBranch: null,
  };
  try {
    const credentials = await resolveStoredCredentials(
      repo.credentials,
      repo.provider
    );
    const settings = (repo.settings ?? null) as Record<string, string> | null;
    const git = createGitRepoAdapter(repo.provider, credentials, settings);
    const branches = await git.listBranches();
    result.branches = branches.map((b) => b.name);
    result.defaultBranch = branches.find((b) => b.isDefault)?.name ?? null;
    if (repo.provider === "GITHUB") {
      const adapter = createCiDispatchAdapter(
        { provider: "GITHUB_ACTIONS", workflowRef: null },
        credentials,
        settings
      );
      result.workflows = await adapter.listWorkflows();
    }
  } catch (err) {
    result.warning = sanitizeExecutionError(err, 300);
  }
  return { success: true, ...result };
}
