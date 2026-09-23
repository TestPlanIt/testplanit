import { randomBytes } from "node:crypto";
import { z } from "zod";
import { runWithAuditContext } from "~/lib/auditContext";
import { baseDb } from "~/lib/db";
import { REPOSITORY_PROVIDER_FOR } from "~/lib/execution/adapters";
import { canManageExecutionTargets } from "~/lib/execution/auth";
import { assertOutboundUrlAllowed } from "~/lib/execution/http";
import {
  describeInputError,
  MAX_INPUT_VALUE_LENGTH,
  normalizeInputs,
  validateCustomInputs,
} from "~/lib/execution/inputs";
import {
  describeParamError,
  MAX_PARAM_LABEL_LENGTH,
  MAX_PARAM_VALUES,
  normalizeParamSchema,
  PARAM_ERROR_CODES,
  validateParamSchema,
} from "~/lib/execution/params";
import type { ExecutionParam } from "~/lib/execution/types";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { encrypt } from "~/utils/encryption";

/**
 * The actor-parameterized core of execution-target CRUD, shared by the
 * session-only "use server" actions (app/actions/execution-targets.ts) and
 * the Bearer-token-capable API routes (app/api/projects/[projectId]/
 * execution-targets/**). Deliberately NOT a "use server" file: an
 * actor-parameterized function exported from one would be a directly
 * callable server action whose `actor` argument is client-controlled — an
 * unauthenticated privilege-escalation path. Every caller of this module
 * must resolve `Actor` itself from a real session or a validated API token
 * before calling in.
 */

export interface Actor {
  userId: string;
  userName?: string;
  userEmail?: string;
  access?: string | null;
}

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

const paramValueSchema = z.string().max(MAX_INPUT_VALUE_LENGTH);
const paramBaseShape = {
  name: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(MAX_PARAM_LABEL_LENGTH),
};
const executionParamSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...paramBaseShape,
      type: z.literal("select"),
      values: z.array(paramValueSchema).max(MAX_PARAM_VALUES),
      default: paramValueSchema,
    })
    .strict(),
  z
    .object({
      ...paramBaseShape,
      type: z.literal("multiselect"),
      values: z.array(paramValueSchema).max(MAX_PARAM_VALUES),
      default: z.array(paramValueSchema).max(MAX_PARAM_VALUES),
    })
    .strict(),
  z
    .object({
      ...paramBaseShape,
      type: z.literal("text"),
      default: paramValueSchema.optional(),
    })
    .strict(),
]);

const targetInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: providerSchema,
  codeRepositoryId: z.number().int().positive().nullable().optional(),
  workflowRef: z.string().trim().max(255).nullable().optional(),
  defaultRef: z.string().trim().max(255).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  staticInputs: z.record(z.string(), z.string()).optional(),
  paramSchema: z.array(executionParamSchema).optional(),
  timeoutMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  isEnabled: z.boolean().optional(),
  credentials: credentialsSchema.nullable().optional(),
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
  paramSchema: ExecutionParam[];
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
  paramSchema: true,
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
  paramSchema: unknown;
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
    paramSchema: normalizeParamSchema(row.paramSchema),
    timeoutMinutes: row.timeoutMinutes,
    isEnabled: row.isEnabled,
    hasOwnCredentials: row.credentials != null,
    lastVerifiedAt: row.lastVerifiedAt,
    lastVerifyError: row.lastVerifyError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireManager(actor: Actor, projectId: number) {
  const ok = await canManageExecutionTargets(
    {
      user: {
        id: actor.userId,
        name: actor.userName,
        email: actor.userEmail,
        access: actor.access,
      },
    } as unknown as Parameters<typeof canManageExecutionTargets>[0],
    projectId
  );
  if (!ok) return { error: "Forbidden" as const };
  return { error: null };
}

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
  const paramErr = validateParamSchema(
    input.paramSchema ?? [],
    normalizeInputs(input.staticInputs)
  );
  if (paramErr) {
    return {
      errorCode: `automation.settings.errors.${PARAM_ERROR_CODES[paramErr.code]}`,
      error: describeParamError(paramErr),
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
    where: {
      id: input.codeRepositoryId,
      isDeleted: false,
      projectConfigs: { some: { projectId } },
    },
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

export function parseTargetInput(rawInput: unknown, partial: boolean) {
  return partial
    ? targetInputSchema.partial().safeParse(rawInput)
    : targetInputSchema.safeParse(rawInput);
}

export async function listExecutionTargetsForActor(
  actor: Actor,
  projectId: number
): Promise<ActionResult<{ targets: ExecutionTargetView[] }>> {
  const gate = await requireManager(actor, projectId);
  if (gate.error) return { success: false, error: gate.error };
  const rows = await baseDb.executionTarget.findMany({
    where: { projectId, isDeleted: false },
    orderBy: [{ name: "asc" }],
    select: targetSelect,
  });
  return { success: true, targets: rows.map(toView) };
}

export async function getExecutionTargetForActor(
  actor: Actor,
  targetId: number
): Promise<ActionResult<{ target: ExecutionTargetView }>> {
  const existing = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    select: targetSelect,
  });
  if (!existing) return { success: false, error: "Target not found" };
  const gate = await requireManager(actor, existing.projectId);
  if (gate.error) return { success: false, error: gate.error };
  return { success: true, target: toView(existing) };
}

export async function createExecutionTargetForActor(
  actor: Actor,
  projectId: number,
  rawInput: ExecutionTargetInput
): Promise<
  ActionResult<{ target: ExecutionTargetView; revealedSecret?: string }>
> {
  const gate = await requireManager(actor, projectId);
  if (gate.error) return { success: false, error: gate.error };

  const parsed = parseTargetInput(rawInput, false);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      errorCode: "automation.settings.errors.invalid",
    };
  }
  const input = parsed.data as ExecutionTargetInput;
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
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail,
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
          defaultRef: input.defaultRef ?? null,
          url:
            input.provider === "GENERIC_WEBHOOK" ? (input.url ?? null) : null,
          staticInputs: normalizeInputs(input.staticInputs),
          paramSchema: input.paramSchema ?? [],
          timeoutMinutes: input.timeoutMinutes ?? 120,
          isEnabled: input.isEnabled ?? true,
          ...(credentials ? { credentials } : {}),
          createdById: actor.userId,
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

export async function updateExecutionTargetForActor(
  actor: Actor,
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
  const gate = await requireManager(actor, existing.projectId);
  if (gate.error) return { success: false, error: gate.error };

  const parsed = parseTargetInput(rawInput, true);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      errorCode: "automation.settings.errors.invalid",
    };
  }
  const partial = parsed.data as Partial<ExecutionTargetInput>;
  const merged: ExecutionTargetInput = {
    name: partial.name ?? existing.name,
    provider: (partial.provider ??
      existing.provider) as ExecutionTargetInput["provider"],
    codeRepositoryId:
      partial.codeRepositoryId !== undefined
        ? partial.codeRepositoryId
        : (existing.codeRepository?.id ?? null),
    workflowRef:
      partial.workflowRef !== undefined
        ? partial.workflowRef
        : existing.workflowRef,
    defaultRef:
      partial.defaultRef !== undefined
        ? partial.defaultRef
        : existing.defaultRef,
    url: partial.url !== undefined ? partial.url : existing.url,
    staticInputs:
      partial.staticInputs !== undefined
        ? partial.staticInputs
        : normalizeInputs(existing.staticInputs),
    paramSchema:
      partial.paramSchema !== undefined
        ? partial.paramSchema
        : normalizeParamSchema(existing.paramSchema),
    timeoutMinutes: partial.timeoutMinutes ?? existing.timeoutMinutes,
    isEnabled: partial.isEnabled ?? existing.isEnabled,
    credentials: partial.credentials,
    rotateSecret: partial.rotateSecret,
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
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail,
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
          paramSchema: merged.paramSchema ?? [],
          timeoutMinutes: merged.timeoutMinutes ?? 120,
          isEnabled: merged.isEnabled ?? true,
          lastVerifiedAt: null,
          lastVerifyError: null,
          ...credentialsPatch,
        },
        select: targetSelect,
      });
      if (clearCredentials) {
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

export async function setExecutionTargetEnabledForActor(
  actor: Actor,
  targetId: number,
  isEnabled: boolean
): Promise<ActionResult<{ target: ExecutionTargetView }>> {
  const existing = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    select: { id: true, projectId: true, name: true },
  });
  if (!existing) return { success: false, error: "Target not found" };
  const gate = await requireManager(actor, existing.projectId);
  if (gate.error) return { success: false, error: gate.error };
  return runWithAuditContext(
    {
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail,
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

export async function deleteExecutionTargetForActor(
  actor: Actor,
  targetId: number
): Promise<{ success: true } | { success: false; error: string }> {
  const existing = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    select: { id: true, projectId: true, name: true },
  });
  if (!existing) return { success: false, error: "Target not found" };
  const gate = await requireManager(actor, existing.projectId);
  if (gate.error) return { success: false, error: gate.error };
  return runWithAuditContext(
    {
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail,
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
