import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetch, createNotification, isMultiTenantMode } = vi.hoisted(
  () => ({
    ssrfSafeFetch: vi.fn(),
    createNotification: vi.fn(),
    isMultiTenantMode: vi.fn(() => false),
  })
);

vi.mock("~/lib/utils/ssrf", () => ({ ssrfSafeFetch }));
vi.mock("~/lib/multiTenantDb", () => ({ isMultiTenantMode }));
vi.mock("./notificationService", () => ({
  NotificationService: { createNotification },
}));
vi.mock("~/package.json", () => ({ default: { version: "1.2.0" } }));

import {
  DEFAULT_RELEASE_CHECK_URL,
  getReleaseCheck,
  isReleaseCheckEnabled,
  parseReleases,
  pickRelease,
  RELEASE_CHECK_CONFIG_KEY,
  runReleaseCheck,
  type PublishedRelease,
  type ReleaseCheckRecord,
} from "./releaseCheck";

function ghRelease(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes("-"),
    html_url: `https://github.com/TestPlanIt/testplanit/releases/tag/${tag}`,
    published_at: "2026-11-01T00:00:00Z",
    ...extra,
  };
}

function published(version: string): PublishedRelease {
  return parseReleases([ghRelease(`v${version}`)])[0];
}

function fakeDb(
  initial: ReleaseCheckRecord | null = null,
  admins = ["a1", "a2"]
) {
  let stored: unknown = initial;
  return {
    get stored() {
      return stored as ReleaseCheckRecord | null;
    },
    appConfig: {
      findUnique: vi.fn(async () => (stored ? { value: stored } : null)),
      upsert: vi.fn(
        async (args: {
          where: { key: string };
          update: { value: unknown };
        }) => {
          stored = args.update.value;
        }
      ),
    },
    user: {
      findMany: vi.fn(async () => admins.map((id) => ({ id }))),
    },
  };
}

function respondWith(tags: string[]) {
  ssrfSafeFetch.mockResolvedValue({
    body: JSON.stringify(tags.map((tag) => ghRelease(tag))),
    finalUrl: DEFAULT_RELEASE_CHECK_URL,
    contentType: "application/json",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isMultiTenantMode.mockReturnValue(false);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RELEASE_CHECK_ENABLED", "");
  vi.stubEnv("RELEASE_CHECK_URL", "");
  vi.stubEnv("IS_TRIAL_INSTANCE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isReleaseCheckEnabled", () => {
  it("is on for a production build with nothing else set", () => {
    expect(isReleaseCheckEnabled({ NODE_ENV: "production" })).toBe(true);
  });

  it.each(["development", "test", undefined])(
    "is off when NODE_ENV is %s",
    (nodeEnv) => {
      expect(isReleaseCheckEnabled({ NODE_ENV: nodeEnv })).toBe(false);
    }
  );

  it("is off when RELEASE_CHECK_ENABLED is false", () => {
    expect(
      isReleaseCheckEnabled({
        NODE_ENV: "production",
        RELEASE_CHECK_ENABLED: "false",
      })
    ).toBe(false);
  });

  it("is off on a trial instance", () => {
    expect(
      isReleaseCheckEnabled({
        NODE_ENV: "production",
        IS_TRIAL_INSTANCE: "true",
      })
    ).toBe(false);
  });

  it("is off in multi-tenant mode", () => {
    isMultiTenantMode.mockReturnValue(true);
    expect(isReleaseCheckEnabled({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("parseReleases", () => {
  it("keeps published v<semver> tags and marks prereleases", () => {
    const releases = parseReleases([
      ghRelease("v1.2.1"),
      ghRelease("v1.3.0-beta.2"),
    ]);
    expect(releases.map((r) => [r.version, r.prerelease])).toEqual([
      ["1.2.1", false],
      ["1.3.0-beta.2", true],
    ]);
  });

  it("treats a prerelease tag as a prerelease even when the flag is unset", () => {
    const [release] = parseReleases([
      ghRelease("v1.3.0-beta.2", { prerelease: false }),
    ]);
    expect(release.prerelease).toBe(true);
  });

  it("drops drafts, other tag shapes and links that are not https", () => {
    expect(
      parseReleases([
        ghRelease("v1.2.1", { draft: true }),
        ghRelease("mcp-server-v2.0.0"),
        ghRelease("1.2.1"),
        ghRelease("v1.2"),
        ghRelease("v1.2.2", { html_url: "javascript:alert(1)" }),
        null,
        "v1.2.3",
      ])
    ).toEqual([]);
  });

  it("rejects a response that is not a list", () => {
    expect(() => parseReleases({ message: "API rate limit exceeded" })).toThrow(
      /not an array/
    );
  });
});

describe("pickRelease", () => {
  it("returns nothing when no stable release is newer", () => {
    expect(
      pickRelease("1.2.0", [published("1.2.0"), published("1.1.21")])
    ).toEqual({});
  });

  it("never offers a prerelease to a stable instance", () => {
    expect(
      pickRelease("1.2.0", [published("1.3.0-beta.4"), published("1.2.0")])
    ).toEqual({});
  });

  it("tells a beta instance about the final release, not the next beta", () => {
    expect(pickRelease("1.2.0-beta.38", [published("1.2.0-beta.39")])).toEqual(
      {}
    );
    expect(
      pickRelease("1.2.0-beta.38", [
        published("1.2.0-beta.39"),
        published("1.2.0"),
      ]).latest?.version
    ).toBe("1.2.0");
  });

  it("picks the highest release whatever order the list is in", () => {
    expect(
      pickRelease("1.2.0", [
        published("1.2.1"),
        published("1.2.10"),
        published("1.2.9"),
      ]).latest?.version
    ).toBe("1.2.10");
  });

  it("adds the newest release on the running line when a later line exists", () => {
    const picked = pickRelease("1.1.20", [
      published("1.2.0"),
      published("1.1.21"),
      published("1.1.22"),
    ]);
    expect(picked.latest?.version).toBe("1.2.0");
    expect(picked.latestOnLine?.version).toBe("1.1.22");
  });

  it("leaves latestOnLine out when it is the latest release", () => {
    const picked = pickRelease("1.2.0", [published("1.2.1")]);
    expect(picked.latest?.version).toBe("1.2.1");
    expect(picked.latestOnLine).toBeUndefined();
  });
});

describe("runReleaseCheck", () => {
  it("does nothing outside a production build", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const db = fakeDb();

    expect(await runReleaseCheck(db)).toEqual({
      status: "disabled",
      notified: 0,
    });
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    expect(db.appConfig.upsert).not.toHaveBeenCalled();
  });

  it("sends the running version and nothing else about the instance", async () => {
    respondWith(["v1.2.0"]);
    await runReleaseCheck(fakeDb());

    expect(ssrfSafeFetch).toHaveBeenCalledWith(DEFAULT_RELEASE_CHECK_URL, {
      headers: {
        "User-Agent": "TestPlanIt/1.2.0",
        Accept: "application/vnd.github+json, application/json",
      },
      contentTypes: ["application/json"],
    });
  });

  it("asks the configured mirror instead of GitHub", async () => {
    vi.stubEnv("RELEASE_CHECK_URL", "https://mirror.internal/releases.json");
    respondWith(["v1.2.0"]);
    await runReleaseCheck(fakeDb());

    expect(ssrfSafeFetch.mock.calls[0][0]).toBe(
      "https://mirror.internal/releases.json"
    );
  });

  it("notifies every active administrator about a newer release", async () => {
    respondWith(["v1.2.1", "v1.2.0", "v1.3.0-beta.1"]);
    const db = fakeDb();

    const outcome = await runReleaseCheck(db, "tenant-a");

    expect(outcome).toEqual({ status: "checked", notified: 2 });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { access: "ADMIN", isActive: true, isDeleted: false },
      select: { id: true },
    });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "a1",
        type: "NEW_RELEASE_AVAILABLE",
        title: "TestPlanIt 1.2.1 is available",
        tenantId: "tenant-a",
        data: {
          currentVersion: "1.2.0",
          latestVersion: "1.2.1",
          latestOnLineVersion: undefined,
          releaseUrl:
            "https://github.com/TestPlanIt/testplanit/releases/tag/v1.2.1",
        },
      })
    );
    expect(db.stored).toMatchObject({
      currentVersion: "1.2.0",
      latest: { version: "1.2.1" },
      notifiedVersion: "1.2.1",
    });
    expect(db.appConfig.upsert.mock.calls[0][0].where).toEqual({
      key: RELEASE_CHECK_CONFIG_KEY,
    });
  });

  it("notifies once per release, however often the job runs", async () => {
    respondWith(["v1.2.1"]);
    const db = fakeDb();

    await runReleaseCheck(db);
    await runReleaseCheck(db);
    expect(createNotification).toHaveBeenCalledTimes(2);

    respondWith(["v1.2.2", "v1.2.1"]);
    await runReleaseCheck(db);
    expect(createNotification).toHaveBeenCalledTimes(4);
    expect(db.stored?.notifiedVersion).toBe("1.2.2");
  });

  it("notifies nobody when the instance is up to date", async () => {
    respondWith(["v1.2.0", "v1.1.21"]);
    const db = fakeDb();

    expect(await runReleaseCheck(db)).toEqual({
      status: "checked",
      notified: 0,
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(db.stored?.latest).toBeUndefined();
  });

  it("keeps the last result and records the error when the request fails", async () => {
    ssrfSafeFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const db = fakeDb({
      checkedAt: "2026-11-01T05:00:00.000Z",
      currentVersion: "1.2.0",
      latest: { version: "1.2.1", url: "https://x/v1.2.1", publishedAt: null },
      notifiedVersion: "1.2.1",
    });

    const outcome = await runReleaseCheck(db);

    expect(outcome).toEqual({ status: "checked", notified: 0 });
    expect(db.stored).toMatchObject({
      latest: { version: "1.2.1" },
      notifiedVersion: "1.2.1",
      lastError: "getaddrinfo ENOTFOUND",
    });
  });

  it("drops a remembered release the instance has since caught up with", async () => {
    ssrfSafeFetch.mockRejectedValue(new Error("offline"));
    const db = fakeDb({
      checkedAt: "2026-11-01T05:00:00.000Z",
      currentVersion: "1.1.21",
      latest: { version: "1.2.0", url: "https://x/v1.2.0", publishedAt: null },
    });

    await runReleaseCheck(db);

    expect(db.stored?.latest).toBeUndefined();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("records an unusable response as an error", async () => {
    ssrfSafeFetch.mockResolvedValue({
      body: JSON.stringify({ message: "API rate limit exceeded" }),
      finalUrl: DEFAULT_RELEASE_CHECK_URL,
      contentType: "application/json",
    });
    const db = fakeDb();

    await runReleaseCheck(db);

    expect(db.stored?.lastError).toMatch(/not an array/);
  });
});

describe("getReleaseCheck", () => {
  const NOW = new Date("2026-11-14T12:00:00.000Z");
  const record = (checkedAt: string): ReleaseCheckRecord => ({
    checkedAt,
    currentVersion: "1.2.0",
    latest: { version: "1.2.1", url: "https://x/v1.2.1", publishedAt: null },
  });

  it("returns the stored result untouched when the check is disabled", async () => {
    vi.stubEnv("RELEASE_CHECK_ENABLED", "false");
    const db = fakeDb(record("2026-01-01T00:00:00.000Z"));

    const result = await getReleaseCheck(db, { now: NOW });

    expect(result?.latest?.version).toBe("1.2.1");
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("serves a result less than a day old without asking again", async () => {
    const db = fakeDb(record("2026-11-14T00:00:00.000Z"));

    await getReleaseCheck(db, { now: NOW });

    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("refreshes a missing result and one that is a day old", async () => {
    respondWith(["v1.2.2"]);

    const fresh = await getReleaseCheck(fakeDb(), { now: NOW });
    expect(fresh?.latest?.version).toBe("1.2.2");

    const db = fakeDb(record("2026-11-13T12:00:00.000Z"));
    await getReleaseCheck(db, { now: NOW });
    expect(db.stored?.latest?.version).toBe("1.2.2");
    expect(ssrfSafeFetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes a result taken by a different version", async () => {
    respondWith(["v1.2.0"]);
    const db = fakeDb({
      ...record("2026-11-14T11:00:00.000Z"),
      currentVersion: "1.1.21",
    });

    const result = await getReleaseCheck(db, { now: NOW });

    expect(result?.currentVersion).toBe("1.2.0");
    expect(result?.latest).toBeUndefined();
  });

  it("never notifies anyone", async () => {
    respondWith(["v1.2.2"]);
    await getReleaseCheck(fakeDb(), { now: NOW });
    expect(createNotification).not.toHaveBeenCalled();
  });
});
