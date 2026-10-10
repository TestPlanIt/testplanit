import type {
  ProjectCodeRepositoryConfigInclude,
} from "@db/input";

// ─────────────────────────────────────────────────────────────────────────────
// Typed include — `as const satisfies ProjectCodeRepositoryConfigInclude`
// makes reintroduction of an unknown field a TS2353 at compile time. The
// `repository` join is `select`-only; `credentials` is INTENTIONALLY ABSENT so
// the secrets column never crosses the wire (defense in depth).
// ─────────────────────────────────────────────────────────────────────────────

export const PROJECT_REPO_CONFIG_INCLUDE = {
  repository: {
    select: {
      id: true,
      name: true,
      provider: true,
      status: true,
      lastTestedAt: true,
      settings: true,
      // credentials INTENTIONALLY ABSENT — defense in depth, never expose secrets in MCP responses
    },
  },
} as const satisfies ProjectCodeRepositoryConfigInclude;

// Per-provider allow-list for the wholesale `settings` JSON: exactly the keys
// each adapter in testplanit/lib/integrations/adapters/*RepoAdapter.ts reads.
// Keys outside this list are stripped at the mapper boundary, so anything
// else that was ever stored under settings never reaches an agent.
export const SETTINGS_ALLOW_LIST = {
  // baseUrl is the API root of a GitHub Enterprise Server install
  // (e.g. "https://ghes.example.com/api/v3"); absent for github.com.
  GITHUB: ["owner", "repo", "baseUrl"],
  // projectPath is the namespaced path ("group/subgroup/project").
  GITLAB: ["baseUrl", "projectPath"],
  // Bitbucket Cloud: workspace + repository slug.
  BITBUCKET: ["workspace", "repoSlug"],
  AZURE_DEVOPS: ["organizationUrl", "project", "repositoryId"],
  GITEA: ["baseUrl", "owner", "repo"],
} as const;

type ProviderKey = keyof typeof SETTINGS_ALLOW_LIST;

function isProviderKey(p: string): p is ProviderKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_ALLOW_LIST, p);
}

export function stripSettings(
  provider: string,
  raw: unknown,
): Record<string, string> {
  if (!raw || typeof raw !== "object" || !isProviderKey(provider)) return {};
  const allow = SETTINGS_ALLOW_LIST[provider];
  const out: Record<string, string> = {};
  for (const key of allow) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// The GitHub adapter stores the API root, not the web host: nothing for
// github.com, or "https://ghes.example.com/api/v3" for GitHub Enterprise
// Server. The web host is that root without its API path.
function githubWebHost(baseUrl: string | undefined): string {
  if (!baseUrl) return "https://github.com";
  const root = trimTrailingSlash(baseUrl);
  if (/^https?:\/\/api\.github\.com$/i.test(root)) return "https://github.com";
  return root.replace(/\/api\/v3$/i, "");
}

export function deriveWebUrl(
  provider: string,
  settings: Record<string, string>,
): string | null {
  switch (provider) {
    case "GITHUB":
      return settings.owner && settings.repo
        ? `${githubWebHost(settings.baseUrl)}/${settings.owner}/${settings.repo}`
        : null;
    case "GITLAB":
      return settings.projectPath
        ? `${trimTrailingSlash(settings.baseUrl || "https://gitlab.com")}/${settings.projectPath.replace(/^\/+/, "")}`
        : null;
    case "BITBUCKET":
      return settings.workspace && settings.repoSlug
        ? `https://bitbucket.org/${settings.workspace}/${settings.repoSlug}`
        : null;
    case "GITEA":
      return settings.baseUrl && settings.owner && settings.repo
        ? `${trimTrailingSlash(settings.baseUrl)}/${settings.owner}/${settings.repo}`
        : null;
    case "AZURE_DEVOPS":
      return settings.organizationUrl &&
        settings.project &&
        settings.repositoryId
        ? `${trimTrailingSlash(settings.organizationUrl)}/${settings.project}/_git/${settings.repositoryId}`
        : null;
    default:
      return null;
  }
}

export interface RawCodeRepoConfigRow {
  id: number;
  projectId: number;
  // "QUICKSCRIPT" (the repository holding the project's automated tests) or
  // "IMPACT" (the application code impact analysis reads).
  purpose: string;
  branch: string | null;
  pathPatterns: unknown;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  cacheStatus: string | null;
  cacheLastFetchedAt: Date | string | null;
  cacheFileCount: number | null;
  cacheContentFileCount?: number | null;
  cacheTotalSize: bigint | number | null;
  cacheError: string | null;
  repository: {
    id: number;
    name: string;
    provider: string;
    status: string;
    lastTestedAt: Date | string | null;
    settings: unknown;
  };
}

export function mapCodeRepoConfig(raw: RawCodeRepoConfigRow) {
  const settings = stripSettings(raw.repository.provider, raw.repository.settings);
  return {
    id: raw.id,
    projectId: raw.projectId,
    purpose: raw.purpose,
    branch: raw.branch ?? null,
    pathPatterns: Array.isArray(raw.pathPatterns) ? raw.pathPatterns : [],
    cacheEnabled: raw.cacheEnabled,
    cacheTtlDays: raw.cacheTtlDays,
    cacheStatus: raw.cacheStatus ?? null,
    cacheLastFetchedAt: raw.cacheLastFetchedAt ?? null,
    cacheFileCount: raw.cacheFileCount ?? null,
    cacheContentFileCount: raw.cacheContentFileCount ?? null,
    // BigInt → Number coercion — JSON.stringify rejects BigInt, so the cache
    // size column must be widened to a regular number at the mapper
    // boundary. PostgreSQL int8 fits in a JS number when the logical value
    // is bytes (Number.MAX_SAFE_INTEGER ≈ 9 PiB).
    cacheTotalSize:
      raw.cacheTotalSize != null ? Number(raw.cacheTotalSize) : null,
    cacheError: raw.cacheError ?? null,
    repository: {
      id: raw.repository.id,
      name: raw.repository.name,
      provider: raw.repository.provider,
      status: raw.repository.status,
      lastTestedAt: raw.repository.lastTestedAt ?? null,
      settings,
      url: deriveWebUrl(raw.repository.provider, settings),
    },
  };
}
