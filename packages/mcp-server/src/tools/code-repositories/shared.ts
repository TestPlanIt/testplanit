
// ─────────────────────────────────────────────────────────────────────────────
// Typed include — `as const`
// makes reintroduction of an unknown field a TS2353 at compile time. The
// `repository` join is `select`-only; `credentials` is INTENTIONALLY ABSENT so
// the secrets column never crosses the wire (defense-in-depth — REPO-01 /
// T-08-CRED-LEAK).
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
} as const;

// Per-provider allow-list for the wholesale `settings` JSON. Keys outside this
// list are stripped at the mapper boundary (T-08-CRED-LEAK mitigation #2).
// Verified against testplanit/lib/integrations/adapters/*RepoAdapter.ts.
export const SETTINGS_ALLOW_LIST = {
  GITHUB: ["owner", "repo"],
  GITLAB: ["baseUrl", "owner", "repo"],
  BITBUCKET: ["baseUrl", "owner", "repo"],
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

export function deriveWebUrl(
  provider: string,
  settings: Record<string, string>,
): string | null {
  switch (provider) {
    case "GITHUB":
      return settings.owner && settings.repo
        ? `https://github.com/${settings.owner}/${settings.repo}`
        : null;
    case "GITLAB":
    case "BITBUCKET":
    case "GITEA":
      return settings.baseUrl && settings.owner && settings.repo
        ? `${settings.baseUrl.replace(/\/$/, "")}/${settings.owner}/${settings.repo}`
        : null;
    case "AZURE_DEVOPS":
      return settings.organizationUrl &&
        settings.project &&
        settings.repositoryId
        ? `${settings.organizationUrl.replace(/\/$/, "")}/${settings.project}/_git/${settings.repositoryId}`
        : null;
    default:
      return null;
  }
}

export interface RawCodeRepoConfigRow {
  id: number;
  projectId: number;
  branch: string | null;
  pathPatterns: unknown;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  cacheStatus: string | null;
  cacheLastFetchedAt: Date | string | null;
  cacheFileCount: number | null;
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
    branch: raw.branch ?? null,
    pathPatterns: Array.isArray(raw.pathPatterns) ? raw.pathPatterns : [],
    cacheEnabled: raw.cacheEnabled,
    cacheTtlDays: raw.cacheTtlDays,
    cacheStatus: raw.cacheStatus ?? null,
    cacheLastFetchedAt: raw.cacheLastFetchedAt ?? null,
    cacheFileCount: raw.cacheFileCount ?? null,
    // BigInt → Number coercion (RESEARCH § Pitfall 6) — JSON.stringify rejects
    // BigInt, so the cache size column must be widened to a regular number at
    // the mapper boundary. PostgreSQL int8 fits in a JS number when the
    // logical value is bytes (Number.MAX_SAFE_INTEGER ≈ 9 PiB).
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
