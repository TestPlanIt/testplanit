import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userPreferencesFindUnique: vi.fn(),
  appConfigFindUnique: vi.fn(),
  notificationCreate: vi.fn(),
  getServerAuthSession: vi.fn(),
  getUpgradeNotificationsBetweenVersions: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: {
      findUnique: (...args: unknown[]) => mocks.userFindUnique(...args),
      update: (...args: unknown[]) => mocks.userUpdate(...args),
    },
    userPreferences: {
      findUnique: (...args: unknown[]) =>
        mocks.userPreferencesFindUnique(...args),
    },
    appConfig: {
      findUnique: (...args: unknown[]) => mocks.appConfigFindUnique(...args),
    },
    notification: {
      create: (...args: unknown[]) => mocks.notificationCreate(...args),
    },
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mocks.getServerAuthSession(),
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withActionAuditContext: <T>(fn: T) => fn,
}));

vi.mock("~/lib/upgrade-notifications", () => ({
  getUpgradeNotificationsBetweenVersions: (...args: unknown[]) =>
    mocks.getUpgradeNotificationsBetweenVersions(...args),
}));

vi.mock("~/package.json", () => ({ default: { version: "2.0.0" } }));

import { checkUpgradeNotifications } from "./upgrade-notifications";

const PENDING = [
  {
    version: "2.0.0",
    notification: { title: "New Feature", message: "<p>Something new</p>" },
  },
];

describe("checkUpgradeNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.userFindUnique.mockResolvedValue({
      lastSeenVersion: "1.9.0",
      access: "USER",
    });
    mocks.userUpdate.mockResolvedValue({});
    mocks.getUpgradeNotificationsBetweenVersions.mockReturnValue(PENDING);
    mocks.userPreferencesFindUnique.mockResolvedValue(null);
    mocks.appConfigFindUnique.mockResolvedValue(null);
    mocks.notificationCreate.mockResolvedValue({ id: "n-1" });
  });

  it("creates a WHATS_NEW row for a user with default preferences", async () => {
    const result = await checkUpgradeNotifications();

    expect(result).toEqual({ success: true, notificationCreated: true });
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        type: "WHATS_NEW",
        title: "New Feature",
        data: expect.objectContaining({
          type: "upgrade_notification",
          fromVersion: "1.9.0",
          toVersion: "2.0.0",
        }),
      }),
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastSeenVersion: "2.0.0" },
    });
  });

  it("creates no row when the user's mode is NONE", async () => {
    mocks.userPreferencesFindUnique.mockResolvedValue({
      notificationMode: "NONE",
      mutedNotificationTypes: [],
    });

    const result = await checkUpgradeNotifications();

    expect(result).toEqual({ success: true, notificationCreated: false });
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    // The version still advances so the notice is not re-offered later.
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastSeenVersion: "2.0.0" },
    });
  });

  it("creates no row when the user has muted What's New", async () => {
    mocks.userPreferencesFindUnique.mockResolvedValue({
      notificationMode: "IN_APP",
      mutedNotificationTypes: ["WHATS_NEW"],
    });

    const result = await checkUpgradeNotifications();

    expect(result).toEqual({ success: true, notificationCreated: false });
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("still delivers when only admin broadcasts are (stale) in the muted set", async () => {
    mocks.userPreferencesFindUnique.mockResolvedValue({
      notificationMode: "IN_APP",
      mutedNotificationTypes: ["SYSTEM_ANNOUNCEMENT"],
    });

    const result = await checkUpgradeNotifications();

    expect(result.notificationCreated).toBe(true);
  });

  it("inherits a global default of NONE through USE_GLOBAL", async () => {
    mocks.userPreferencesFindUnique.mockResolvedValue({
      notificationMode: "USE_GLOBAL",
      mutedNotificationTypes: [],
    });
    mocks.appConfigFindUnique.mockResolvedValue({
      value: { defaultMode: "NONE" },
    });

    const result = await checkUpgradeNotifications();

    expect(result.notificationCreated).toBe(false);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("only records the version for a first-time user", async () => {
    mocks.userFindUnique.mockResolvedValue({
      lastSeenVersion: null,
      access: "USER",
    });

    const result = await checkUpgradeNotifications();

    expect(result).toEqual({ success: true, notificationCreated: false });
    expect(mocks.userPreferencesFindUnique).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.getServerAuthSession.mockResolvedValue(null);

    const result = await checkUpgradeNotifications();

    expect(result.success).toBe(false);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });
});
