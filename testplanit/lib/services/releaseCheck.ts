import packageJson from "~/package.json";
import { isMultiTenantMode } from "~/lib/multiTenantDb";
import { compareVersions } from "~/lib/upgrade-notifications";
import { ssrfSafeFetch } from "~/lib/utils/ssrf";
import { NotificationType } from "~/zenstack/models";

import { NotificationService } from "./notificationService";

/** The `AppConfig` row that holds the last check's result. */
export const RELEASE_CHECK_CONFIG_KEY = "releaseCheck";

export const DEFAULT_RELEASE_CHECK_URL =
  "https://api.github.com/repos/TestPlanIt/testplanit/releases?per_page=100";

/** How long a stored result is served before the admin notice refreshes it. */
export const RELEASE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ReleaseInfo {
  version: string;
  url: string;
  publishedAt: string | null;
}

export interface ReleaseCheckRecord {
  checkedAt: string;
  currentVersion: string;
  /** The newest stable release, when it is newer than the running version. */
  latest?: ReleaseInfo;
  /** The newest stable release on the running version's own minor line. */
  latestOnLine?: ReleaseInfo;
  /** The `latest.version` administrators were last notified about. */
  notifiedVersion?: string;
  lastError?: string;
}

export interface PublishedRelease extends ReleaseInfo {
  prerelease: boolean;
}

/** Where the last result is kept. */
export interface ReleaseCheckStore {
  appConfig: {
    findUnique(args: {
      where: { key: string };
    }): Promise<{ value: unknown } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: any };
      update: { value: any };
    }): Promise<unknown>;
  };
}

/** The slice of a database client the daily job needs. */
export interface ReleaseCheckDb extends ReleaseCheckStore {
  user: {
    findMany(args: {
      where: { access: "ADMIN"; isActive: true; isDeleted: false };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
}

const RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

export function getRunningVersion(): string {
  return packageJson.version;
}

/**
 * Whether this instance looks for new releases at all.
 *
 * Only a production build does. Instances TestPlanIt runs (shared multi-tenant
 * workers, trials) are upgraded by TestPlanIt, so their administrators are not
 * told. `RELEASE_CHECK_ENABLED=false` switches it off anywhere.
 */
export function isReleaseCheckEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.RELEASE_CHECK_ENABLED === "false") return false;
  if (env.IS_TRIAL_INSTANCE === "true") return false;
  return !isMultiTenantMode();
}

export function getReleaseCheckUrl(
  env: Record<string, string | undefined> = process.env
): string {
  return env.RELEASE_CHECK_URL?.trim() || DEFAULT_RELEASE_CHECK_URL;
}

/** Read a GitHub "list releases" response, keeping published `v<semver>` tags. */
export function parseReleases(payload: unknown): PublishedRelease[] {
  if (!Array.isArray(payload)) {
    throw new Error("The release list is not an array");
  }
  const releases: PublishedRelease[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const { tag_name, draft, prerelease, html_url, published_at } =
      entry as Record<string, unknown>;
    if (draft === true || typeof tag_name !== "string") continue;
    const version = RELEASE_TAG.exec(tag_name)?.[1];
    if (!version) continue;
    if (typeof html_url !== "string" || !html_url.startsWith("https://")) {
      continue;
    }
    releases.push({
      version,
      url: html_url,
      publishedAt: typeof published_at === "string" ? published_at : null,
      prerelease: prerelease === true || !STABLE_VERSION.test(version),
    });
  }
  return releases;
}

function minorLine(version: string): string {
  return version.split("-")[0].split(".").slice(0, 2).join(".");
}

function toReleaseInfo(release: PublishedRelease): ReleaseInfo {
  return {
    version: release.version,
    url: release.url,
    publishedAt: release.publishedAt,
  };
}

/**
 * The releases worth telling an administrator about.
 *
 * Prereleases never count, whatever the instance runs: one on a beta hears
 * about the final release of its line, not about the next beta.
 */
export function pickRelease(
  current: string,
  releases: PublishedRelease[]
): { latest?: ReleaseInfo; latestOnLine?: ReleaseInfo } {
  const newer = releases
    .filter(
      (release) =>
        !release.prerelease && compareVersions(release.version, current) > 0
    )
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = newer[0];
  if (!latest) return {};

  const line = minorLine(current);
  const onLine = newer.find((release) => minorLine(release.version) === line);
  return {
    latest: toReleaseInfo(latest),
    ...(onLine && onLine.version !== latest.version
      ? { latestOnLine: toReleaseInfo(onLine) }
      : {}),
  };
}

export async function fetchLatestReleases(
  url: string = getReleaseCheckUrl()
): Promise<PublishedRelease[]> {
  const { body } = await ssrfSafeFetch(url, {
    headers: {
      "User-Agent": `TestPlanIt/${getRunningVersion()}`,
      Accept: "application/vnd.github+json, application/json",
    },
    contentTypes: ["application/json"],
  });
  return parseReleases(JSON.parse(body));
}

function isReleaseInfo(value: unknown): value is ReleaseInfo {
  if (!value || typeof value !== "object") return false;
  const { version, url } = value as Record<string, unknown>;
  return typeof version === "string" && typeof url === "string";
}

export async function readReleaseCheck(
  db: ReleaseCheckStore
): Promise<ReleaseCheckRecord | null> {
  const row = await db.appConfig.findUnique({
    where: { key: RELEASE_CHECK_CONFIG_KEY },
  });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.checkedAt !== "string" ||
    typeof record.currentVersion !== "string"
  ) {
    return null;
  }
  return {
    checkedAt: record.checkedAt,
    currentVersion: record.currentVersion,
    ...(isReleaseInfo(record.latest) ? { latest: record.latest } : {}),
    ...(isReleaseInfo(record.latestOnLine)
      ? { latestOnLine: record.latestOnLine }
      : {}),
    ...(typeof record.notifiedVersion === "string"
      ? { notifiedVersion: record.notifiedVersion }
      : {}),
    ...(typeof record.lastError === "string"
      ? { lastError: record.lastError }
      : {}),
  };
}

async function writeReleaseCheck(
  db: ReleaseCheckStore,
  record: ReleaseCheckRecord
): Promise<void> {
  await db.appConfig.upsert({
    where: { key: RELEASE_CHECK_CONFIG_KEY },
    create: { key: RELEASE_CHECK_CONFIG_KEY, value: record },
    update: { value: record },
  });
}

/** A stored release is only still news while it is ahead of what is running. */
function stillNewer(
  release: ReleaseInfo | undefined,
  current: string
): ReleaseInfo | undefined {
  return release && compareVersions(release.version, current) > 0
    ? release
    : undefined;
}

/**
 * Ask the release source what is newest and store the answer.
 *
 * A failed request keeps what the last successful one found and records the
 * error beside it. It never throws.
 */
export async function refreshReleaseCheck(
  db: ReleaseCheckStore,
  now: Date = new Date()
): Promise<ReleaseCheckRecord> {
  const current = getRunningVersion();
  const previous = await readReleaseCheck(db);
  const base = {
    checkedAt: now.toISOString(),
    currentVersion: current,
    ...(previous?.notifiedVersion
      ? { notifiedVersion: previous.notifiedVersion }
      : {}),
  };

  let record: ReleaseCheckRecord;
  try {
    record = { ...base, ...pickRelease(current, await fetchLatestReleases()) };
  } catch (error) {
    const latest = stillNewer(previous?.latest, current);
    const latestOnLine = stillNewer(previous?.latestOnLine, current);
    record = {
      ...base,
      ...(latest ? { latest } : {}),
      ...(latest && latestOnLine ? { latestOnLine } : {}),
      lastError: error instanceof Error ? error.message : String(error),
    };
  }

  await writeReleaseCheck(db, record);
  return record;
}

/**
 * The stored result, refreshed first when it is missing, a day old, or was
 * taken by a different version of the application.
 */
export async function getReleaseCheck(
  db: ReleaseCheckStore,
  options: { now?: Date } = {}
): Promise<ReleaseCheckRecord | null> {
  const now = options.now ?? new Date();
  const stored = await readReleaseCheck(db);
  if (!isReleaseCheckEnabled()) return stored;

  const age = stored
    ? now.getTime() - new Date(stored.checkedAt).getTime()
    : Infinity;
  const stale =
    !stored ||
    stored.currentVersion !== getRunningVersion() ||
    age >= RELEASE_CHECK_MAX_AGE_MS;
  return stale ? refreshReleaseCheck(db, now) : stored;
}

/**
 * The daily job: check, then tell every active administrator about a release
 * they have not been told about yet. Remembering the version makes a retried
 * or repeated run create nothing twice.
 */
export async function runReleaseCheck(
  db: ReleaseCheckDb,
  tenantId?: string
): Promise<{ status: "disabled" | "checked"; notified: number }> {
  if (!isReleaseCheckEnabled()) return { status: "disabled", notified: 0 };

  const record = await refreshReleaseCheck(db);
  const latest = record.latest;
  if (!latest || latest.version === record.notifiedVersion) {
    return { status: "checked", notified: 0 };
  }

  const admins = await db.user.findMany({
    where: { access: "ADMIN", isActive: true, isDeleted: false },
    select: { id: true },
  });
  await Promise.all(
    admins.map((admin) =>
      NotificationService.createNotification({
        userId: admin.id,
        type: NotificationType.NEW_RELEASE_AVAILABLE,
        title: `TestPlanIt ${latest.version} is available`,
        message: `You are running ${record.currentVersion}. See the release notes before upgrading.`,
        tenantId,
        data: {
          currentVersion: record.currentVersion,
          latestVersion: latest.version,
          latestOnLineVersion: record.latestOnLine?.version,
          releaseUrl: latest.url,
        },
      })
    )
  );

  await writeReleaseCheck(db, { ...record, notifiedVersion: latest.version });
  return { status: "checked", notified: admins.length };
}
