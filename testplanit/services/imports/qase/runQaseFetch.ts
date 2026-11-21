import type { JsonObject } from "@zenstackhq/orm";
import type { DbClient } from "~/lib/zenstack";
import { decrypt } from "~/utils/encryption";
import { fetchQaseData, QaseFetchCanceledError } from "./fetchQaseData";
import { QaseClient, type QaseClientOptions } from "./qaseClient";
import type { QaseFetchProgress, QaseProjectSummary } from "./types";

export interface RunQaseFetchOptions {
  db: DbClient;
  jobId: string;
  /** Test seam for the HTTP layer. */
  clientOptions?: Partial<QaseClientOptions>;
}

/**
 * The fetch phase of a Qase import job: copies the selected projects into
 * staging and leaves the job READY, CANCELED or FAILED.
 */
export async function runQaseFetch({
  db,
  jobId,
  clientOptions,
}: RunQaseFetchOptions): Promise<void> {
  const job = await db.qaseImportJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      apiHost: true,
      apiToken: true,
      projects: true,
      cancelRequested: true,
    },
  });
  if (!job) {
    throw new Error(`Qase import job ${jobId} not found`);
  }

  const markCanceled = async () => {
    await db.qaseImportStaging.deleteMany({ where: { jobId } });
    await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        status: "CANCELED",
        statusMessage: "Canceled",
        canceledAt: new Date(),
        currentEntity: null,
        apiToken: null,
      },
    });
  };

  if (job.cancelRequested) {
    await markCanceled();
    return;
  }

  const startedAt = new Date();
  await db.qaseImportJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      phase: "FETCHING",
      statusMessage: "Fetching data from Qase",
      startedAt,
      completedAt: null,
      durationMs: null,
      error: null,
      fetchProgress: {},
    },
  });

  try {
    if (!job.apiToken) {
      throw new Error("The job has no Qase API token.");
    }
    const client = new QaseClient({
      ...clientOptions,
      token: await decrypt(job.apiToken),
      host: job.apiHost,
    });
    const projectCodes = (
      Array.isArray(job.projects)
        ? (job.projects as unknown as QaseProjectSummary[])
        : []
    ).map((project) => project.code);

    const progress = await fetchQaseData({
      db,
      client,
      jobId,
      projectCodes,
      isCanceled: async () => {
        const current = await db.qaseImportJob.findUnique({
          where: { id: jobId },
          select: { cancelRequested: true },
        });
        return !current || current.cancelRequested;
      },
      onProgress: async (current: QaseFetchProgress, entity: string) => {
        await db.qaseImportJob.update({
          where: { id: jobId },
          data: {
            fetchProgress: current as unknown as JsonObject,
            currentEntity: entity,
          },
        });
      },
    });

    await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        status: "READY",
        phase: "CONFIGURING",
        statusMessage: "Data fetched from Qase",
        fetchProgress: progress as unknown as JsonObject,
        currentEntity: null,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
  } catch (error) {
    if (error instanceof QaseFetchCanceledError) {
      await markCanceled();
      return;
    }
    await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        statusMessage: "The fetch from Qase failed",
        error: error instanceof Error ? error.message : String(error),
        currentEntity: null,
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    throw error;
  }
}
