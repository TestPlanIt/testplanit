import { baseDb } from "@/lib/db";
import type { Session } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  createGitRepoAdapter,
  type GitRepoAdapter,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { resolveStoredCredentials } from "~/lib/integrations/credentials";

export type RepoConfigPurpose = "QUICKSCRIPT" | "IMPACT";

export interface LoadedRepoConfig {
  id: number;
  projectId: number;
  purpose: RepoConfigPurpose;
  branch: string | null;
  cacheEnabled: boolean;
  repositoryId: number;
  repository: {
    id: number;
    name: string;
    provider: string;
    settings: unknown;
  };
}

export interface LoadedRepo {
  config: LoadedRepoConfig;
  adapter: GitRepoAdapter;
}

const configSelect = {
  id: true,
  projectId: true,
  purpose: true,
  branch: true,
  cacheEnabled: true,
  repositoryId: true,
  repository: {
    select: {
      id: true,
      name: true,
      provider: true,
      settings: true,
      isDeleted: true,
    },
  },
} as const;

/**
 * Credentials are read only here, only through the un-policed client, and
 * only to build an adapter that never leaves the server.
 */
async function buildAdapter(
  repositoryId: number,
  provider: string,
  settings: unknown
): Promise<GitRepoAdapter> {
  const repo = await baseDb.codeRepository.findUnique({
    where: { id: repositoryId },
    select: { credentials: true },
  });
  const credentials = await resolveStoredCredentials(
    repo?.credentials,
    provider
  );
  return createGitRepoAdapter(
    provider,
    credentials,
    (settings as Record<string, string> | null) ?? null
  );
}

type ConfigRow = {
  id: number;
  projectId: number;
  purpose: RepoConfigPurpose;
  branch: string | null;
  cacheEnabled: boolean;
  repositoryId: number;
  repository: {
    id: number;
    name: string;
    provider: string;
    settings: unknown;
    isDeleted: boolean;
  };
};

async function toLoadedRepo(row: ConfigRow | null): Promise<LoadedRepo | null> {
  if (!row || row.repository.isDeleted) return null;
  const adapter = await buildAdapter(
    row.repositoryId,
    row.repository.provider,
    row.repository.settings
  );
  const { isDeleted: _ignored, ...repository } = row.repository;
  return {
    config: {
      id: row.id,
      projectId: row.projectId,
      purpose: row.purpose,
      branch: row.branch,
      cacheEnabled: row.cacheEnabled,
      repositoryId: row.repositoryId,
      repository,
    },
    adapter,
  };
}

/**
 * Load a project repo config the caller is allowed to see (ZenStack policy on
 * the enhanced client is the authorization) and build its git adapter.
 * Returns null when the config is not visible, does not belong to
 * `repositoryId` (when given), or its repository is gone.
 */
export async function loadRepoConfigForUser(
  session: Session | null,
  configId: number,
  opts: { purpose?: RepoConfigPurpose; repositoryId?: number } = {}
): Promise<LoadedRepo | null> {
  const db = await getEnhancedDb(session);
  const row = (await db.projectCodeRepositoryConfig.findFirst({
    where: {
      id: configId,
      ...(opts.purpose ? { purpose: opts.purpose } : {}),
      ...(opts.repositoryId ? { repositoryId: opts.repositoryId } : {}),
    },
    select: configSelect,
  })) as ConfigRow | null;
  return toLoadedRepo(row);
}

/**
 * Same as loadRepoConfigForUser but for workers and services that already run
 * with a raw (un-policed) client and have authorized the job elsewhere.
 */
type ConfigReader = {
  projectCodeRepositoryConfig: {
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
};

export async function loadRepoConfigForWorker(
  db: ConfigReader,
  configId: number,
  opts: { purpose?: RepoConfigPurpose } = {}
): Promise<LoadedRepo | null> {
  const row = (await db.projectCodeRepositoryConfig.findFirst({
    where: {
      id: configId,
      ...(opts.purpose ? { purpose: opts.purpose } : {}),
    },
    select: configSelect,
  })) as ConfigRow | null;
  return toLoadedRepo(row);
}

/** Ids of every Impact config connected to a project, oldest first. */
export async function listImpactConfigIds(
  db: ConfigReader,
  projectId: number
): Promise<number[]> {
  const rows = (await db.projectCodeRepositoryConfig.findMany({
    where: { projectId, purpose: "IMPACT" },
    select: { id: true },
    orderBy: { id: "asc" },
  })) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

export type ImpactConfigResolution =
  { configId: number } | { error: "none" | "ambiguous" | "unknown" };

/**
 * Pick the Impact config an analysis should run against. A project with one
 * connected repository needs no `configId`; with several, the caller must
 * name one, and it has to be one of the project's own.
 */
export async function resolveImpactConfigId(
  db: ConfigReader,
  projectId: number,
  requestedConfigId?: number | null
): Promise<ImpactConfigResolution> {
  const ids = await listImpactConfigIds(db, projectId);
  if (ids.length === 0) return { error: "none" };
  if (requestedConfigId != null) {
    return ids.includes(requestedConfigId)
      ? { configId: requestedConfigId }
      : { error: "unknown" };
  }
  if (ids.length > 1) return { error: "ambiguous" };
  return { configId: ids[0] };
}
