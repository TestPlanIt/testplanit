import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ getServerAuthSession: vi.fn() }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));
vi.mock("~/lib/services/releaseCheck", () => ({
  getReleaseCheck: vi.fn(),
  getRunningVersion: vi.fn(() => "1.2.0"),
  isReleaseCheckEnabled: vi.fn(() => true),
}));

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  getReleaseCheck,
  isReleaseCheckEnabled,
} from "~/lib/services/releaseCheck";
import { getServerAuthSession } from "~/server/auth";
import { GET } from "./route";

const session = vi.mocked(getServerAuthSession);
const enhancedDb = vi.mocked(getEnhancedDb);
const releaseCheck = vi.mocked(getReleaseCheck);
const enabled = vi.mocked(isReleaseCheckEnabled);

const admin = { user: { id: "admin-1", access: "ADMIN" } } as any;
const db = { appConfig: {} } as any;
const record = {
  checkedAt: "2026-11-14T05:00:00.000Z",
  currentVersion: "1.2.0",
  latest: { version: "1.2.1", url: "https://x/v1.2.1", publishedAt: null },
  notifiedVersion: "1.2.1",
};

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(admin);
  enhancedDb.mockResolvedValue(db);
  enabled.mockReturnValue(true);
  releaseCheck.mockResolvedValue(record);
});

describe("/api/admin/release-check", () => {
  it("refuses a signed-out caller", async () => {
    session.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(releaseCheck).not.toHaveBeenCalled();
  });

  it.each(["USER", "PROJECTADMIN"])("refuses a %s", async (access) => {
    session.mockResolvedValue({ user: { id: "u-1", access } } as any);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(releaseCheck).not.toHaveBeenCalled();
  });

  it("returns the newest release to an administrator", async () => {
    const response = await GET();

    expect(releaseCheck).toHaveBeenCalledWith(db);
    expect(await response.json()).toEqual({
      enabled: true,
      currentVersion: "1.2.0",
      latest: record.latest,
      latestOnLine: null,
      checkedAt: record.checkedAt,
      lastError: null,
    });
  });

  it("reports nothing and reads nothing while the check is disabled", async () => {
    enabled.mockReturnValue(false);

    const response = await GET();

    expect(await response.json()).toEqual({
      enabled: false,
      currentVersion: "1.2.0",
      latest: null,
      latestOnLine: null,
      checkedAt: null,
      lastError: null,
    });
    expect(releaseCheck).not.toHaveBeenCalled();
  });

  it("returns an empty result before the first check has been stored", async () => {
    releaseCheck.mockResolvedValue(null);

    const response = await GET();

    expect(await response.json()).toMatchObject({
      enabled: true,
      latest: null,
      checkedAt: null,
    });
  });
});
