"use server";

import { createCiDispatchAdapter } from "~/lib/execution/adapters";
import { canManageExecutionTargets } from "~/lib/execution/auth";
import type { Actor } from "~/lib/execution/executionTargetsService";
import {
  createExecutionTargetForActor,
  deleteExecutionTargetForActor,
  getExecutionTargetForActor,
  listExecutionTargetsForActor,
  setExecutionTargetEnabledForActor,
  updateExecutionTargetForActor,
  type ExecutionTargetInput,
  type ExecutionTargetView,
} from "~/lib/execution/executionTargetsService";
import { normalizeParamSchema } from "~/lib/execution/params";
import {
  resolveTargetCredentials,
  sanitizeExecutionError,
} from "~/lib/execution/service";
import type {
  DispatchCapability,
  ExecutionParam,
  WorkflowChoice,
} from "~/lib/execution/types";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { resolveStoredCredentials } from "~/lib/integrations/credentials";
import { baseDb } from "~/lib/db";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { ApplicationArea } from "~/zenstack/models";
import { getServerAuthSession } from "~/server/auth";

/**
 * Thin session-resolving wrappers around lib/execution/executionTargetsService.ts,
 * which holds the actual create/update/delete logic (credential encryption,
 * SSRF checks, audit events) so it can also be called from the Bearer-token
 * API routes under app/api/projects/[projectId]/execution-targets/**. Do not
 * add actor-parameterized logic here — anything exported from a "use server"
 * file is a directly callable server action, and a client-supplied `actor`
 * would be an unauthenticated privilege-escalation path.
 */

export type { ExecutionTargetInput, ExecutionTargetView };

type ActionResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string; errorCode?: string };

async function currentActor(): Promise<Actor | null> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    userName: session.user.name ?? undefined,
    userEmail: session.user.email ?? undefined,
    access: session.user.access,
  };
}

export interface ExecutionTargetChoice {
  id: number;
  name: string;
  provider: "GITHUB_ACTIONS" | "GITLAB_CI" | "GENERIC_WEBHOOK";
  defaultRef: string | null;
  isEnabled: boolean;
  /** Parameters the dispatcher fills in; option lists and defaults only. */
  paramSchema: ExecutionParam[];
}

/**
 * The sanitized list the run page and the case dialog need: anyone who may
 * trigger automated executions in the project may see which targets exist.
 * No credentials, URLs or static inputs leave the server; the parameter
 * declarations do, because the dispatcher has to see the choices to make
 * them.
 */
export async function listExecutionTargetChoices(
  projectId: number
): Promise<ActionResult<{ targets: ExecutionTargetChoice[] }>> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  const allowed = await userCanAddEditArea(
    session.user.id,
    projectId,
    ApplicationArea.AutomatedExecution,
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
      paramSchema: true,
    },
  });
  return {
    success: true,
    targets: rows.map((r) => ({
      ...r,
      provider: r.provider as ExecutionTargetChoice["provider"],
      paramSchema: normalizeParamSchema(r.paramSchema),
    })),
  };
}

export async function listExecutionTargets(
  projectId: number
): Promise<ActionResult<{ targets: ExecutionTargetView[] }>> {
  const actor = await currentActor();
  if (!actor) return { success: false, error: "Unauthorized" };
  return listExecutionTargetsForActor(actor, projectId);
}

export async function createExecutionTarget(
  projectId: number,
  rawInput: ExecutionTargetInput
): Promise<
  ActionResult<{ target: ExecutionTargetView; revealedSecret?: string }>
> {
  const actor = await currentActor();
  if (!actor) return { success: false, error: "Unauthorized" };
  return createExecutionTargetForActor(actor, projectId, rawInput);
}

export async function updateExecutionTarget(
  targetId: number,
  rawInput: Partial<ExecutionTargetInput>
): Promise<
  ActionResult<{ target: ExecutionTargetView; revealedSecret?: string }>
> {
  const actor = await currentActor();
  if (!actor) return { success: false, error: "Unauthorized" };
  return updateExecutionTargetForActor(actor, targetId, rawInput);
}

export async function setExecutionTargetEnabled(
  targetId: number,
  isEnabled: boolean
): Promise<ActionResult<{ target: ExecutionTargetView }>> {
  const actor = await currentActor();
  if (!actor) return { success: false, error: "Unauthorized" };
  return setExecutionTargetEnabledForActor(actor, targetId, isEnabled);
}

export async function deleteExecutionTarget(
  targetId: number
): Promise<{ success: true } | { success: false; error: string }> {
  const actor = await currentActor();
  if (!actor) return { success: false, error: "Unauthorized" };
  return deleteExecutionTargetForActor(actor, targetId);
}

// Re-exported so a future caller could resolve a single target by id without
// duplicating the actor-resolution boilerplate; not currently used by the UI.
export async function getExecutionTarget(
  targetId: number
): Promise<ActionResult<{ target: ExecutionTargetView }>> {
  const actor = await currentActor();
  if (!actor) return { success: false, error: "Unauthorized" };
  return getExecutionTargetForActor(actor, targetId);
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
 * Read-only reachability check: does the credential work, does the workflow
 * exist and declare the inputs TestPlanIt sends. Stores the outcome on the
 * target so the list can show it.
 */
export async function verifyExecutionTarget(
  targetId: number
): Promise<ActionResult<{ capability: DispatchCapability }>> {
  const target = await baseDb.executionTarget.findFirst({
    where: { id: targetId, isDeleted: false },
    // Credentials are @omit on the repository; the dispatch needs them.
    include: {
      codeRepository: {
        select: {
          id: true,
          name: true,
          provider: true,
          settings: true,
          credentials: true,
        },
      },
    },
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
    where: {
      id: codeRepositoryId,
      isDeleted: false,
      projectConfigs: { some: { projectId } },
    },
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
