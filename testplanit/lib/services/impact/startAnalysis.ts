import { RefNotFoundError, resolveRefToSha } from "./compareService";
import { impactConfig } from "./config";
import { impactJobId } from "./jobKeys";
import type { LoadedRepo } from "./repoAccess";
import type { ImpactAnalysisJobData, ImpactAutoRun } from "./types";

/** The db surface starting an analysis needs; enhanced or raw client alike. */
export interface StartAnalysisDb {
  impactAnalysis: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
}

export interface StartAnalysisQueue {
  add: (
    name: string,
    data: unknown,
    opts: { jobId: string }
  ) => Promise<unknown>;
}

export interface StartAnalysisInput {
  projectId: number;
  base: string;
  head: string;
  /** Recorded as the analysis creator; the webhook path uses the project creator. */
  createdById: string;
  notes?: string | null;
  /** Skip the recent-analysis reuse and run fresh. */
  force?: boolean;
  tenantId?: string;
  trigger?: string | null;
  triggerLabel?: string | null;
  triggerUrl?: string | null;
  autoRun?: ImpactAutoRun;
}

export type StartAnalysisResult =
  | { ok: true; analysisId: number; jobId: string | null; reused: boolean }
  | {
      ok: false;
      code:
        | "ref_not_found"
        | "same_commit"
        | "queue_unavailable"
        | "enqueue_failed";
      message: string;
      /** Set when a row was written before the failure was recorded on it. */
      analysisId?: number;
    };

/**
 * Resolve base and head, reuse a recent completed analysis of the same pair
 * unless forced, otherwise create the row and enqueue the worker job. The
 * one path behind the API route and the repository webhooks, so both keep
 * the same reuse window, job id and failure bookkeeping.
 */
export async function startImpactAnalysis(
  db: StartAnalysisDb,
  loaded: LoadedRepo,
  queue: StartAnalysisQueue | null,
  input: StartAnalysisInput
): Promise<StartAnalysisResult> {
  const configId = loaded.config.id;
  let baseSha: string;
  let headSha: string;
  try {
    [baseSha, headSha] = await Promise.all([
      resolveRefToSha(loaded.adapter, input.base),
      resolveRefToSha(loaded.adapter, input.head),
    ]);
  } catch (error) {
    if (error instanceof RefNotFoundError) {
      return { ok: false, code: "ref_not_found", message: error.message };
    }
    throw error;
  }
  if (baseSha === headSha) {
    return {
      ok: false,
      code: "same_commit",
      message: "Base and head resolve to the same commit",
    };
  }

  if (!input.force) {
    const reusable = await db.impactAnalysis.findFirst({
      where: {
        configId,
        baseSha,
        headSha,
        status: "COMPLETED",
        isDeleted: false,
        createdAt: {
          gte: new Date(Date.now() - impactConfig.reuseHours * 3600_000),
        },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, jobId: true },
    });
    if (reusable) {
      return {
        ok: true,
        analysisId: reusable.id,
        jobId: reusable.jobId ?? null,
        reused: true,
      };
    }
  }

  const created = await db.impactAnalysis.create({
    data: {
      projectId: input.projectId,
      configId,
      baseSha,
      headSha,
      baseRef: input.base === baseSha ? null : input.base,
      headRef: input.head === headSha ? null : input.head,
      notes: input.notes ?? null,
      trigger: input.trigger ?? null,
      triggerLabel: input.triggerLabel ?? null,
      triggerUrl: input.triggerUrl ?? null,
      createdById: input.createdById,
    },
    select: { id: true },
  });

  if (!queue) {
    await db.impactAnalysis.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
        error: "Background job queue is not available",
      },
    });
    return {
      ok: false,
      code: "queue_unavailable",
      message: "Background job queue is not available",
      analysisId: created.id,
    };
  }

  const jobId = impactJobId(created.id);
  const jobData: ImpactAnalysisJobData = {
    analysisId: created.id,
    projectId: input.projectId,
    configId,
    baseSha,
    headSha,
    userId: input.createdById,
    notes: input.notes ?? undefined,
    tenantId: input.tenantId,
    autoRun: input.autoRun,
  };
  try {
    await queue.add("analyze", jobData, { jobId });
  } catch (error) {
    await db.impactAnalysis.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Enqueue failed",
      },
    });
    return {
      ok: false,
      code: "enqueue_failed",
      message: "Failed to enqueue analysis",
      analysisId: created.id,
    };
  }
  await db.impactAnalysis.update({
    where: { id: created.id },
    data: { jobId },
  });
  return { ok: true, analysisId: created.id, jobId, reused: false };
}
