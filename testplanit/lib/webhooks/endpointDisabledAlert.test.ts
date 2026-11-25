import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectAdminIds: vi.fn(),
  activeOrSystemAdmins: vi.fn(),
  create: vi.fn(),
}));
vi.mock("~/lib/services/caseUpkeep/recipients", () => ({
  projectAdminIds: mocks.projectAdminIds,
  activeOrSystemAdmins: mocks.activeOrSystemAdmins,
}));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createWebhookEndpointDisabledNotification: mocks.create,
  },
}));

import { notifyEndpointDisabled } from "./endpointDisabledAlert";

const makeDb = (
  config: Record<string, unknown> | null,
  project: Record<string, unknown> | null = { name: "Telco" }
) => ({
  webhookConfig: { findUnique: vi.fn().mockResolvedValue(config) },
  projects: { findUnique: vi.fn().mockResolvedValue(project) },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectAdminIds.mockResolvedValue(["creator", "padmin"]);
  mocks.activeOrSystemAdmins.mockImplementation(
    async (_db: unknown, base: string[]) => base
  );
  mocks.create.mockResolvedValue("job-1");
});

describe("notifyEndpointDisabled", () => {
  it("tells the project's administrators, naming the endpoint and the project", async () => {
    const db = makeDb({
      name: "Release channel",
      adapterType: "SLACK",
      projectId: 7,
    });

    expect(
      await notifyEndpointDisabled(db, {
        webhookConfigId: "cfg-1",
        tenantId: "tenant-a",
      })
    ).toBe(2);

    expect(db.webhookConfig.findUnique).toHaveBeenCalledWith({
      where: { id: "cfg-1" },
      select: { name: true, adapterType: true, projectId: true },
    });
    expect(mocks.projectAdminIds).toHaveBeenCalledWith(db, 7);
    expect(mocks.activeOrSystemAdmins).toHaveBeenCalledWith(db, [
      "creator",
      "padmin",
    ]);
    expect(mocks.create.mock.calls.map((call) => call[0])).toEqual([
      {
        userId: "creator",
        webhookConfigId: "cfg-1",
        endpointName: "Release channel",
        projectId: 7,
        projectName: "Telco",
        tenantId: "tenant-a",
      },
      {
        userId: "padmin",
        webhookConfigId: "cfg-1",
        endpointName: "Release channel",
        projectId: 7,
        projectName: "Telco",
        tenantId: "tenant-a",
      },
    ]);
  });

  it("tells whoever the fallback returns when no project administrator is active", async () => {
    mocks.activeOrSystemAdmins.mockResolvedValue(["sysadmin"]);
    const db = makeDb({
      name: "Release channel",
      adapterType: "SLACK",
      projectId: 7,
    });

    expect(await notifyEndpointDisabled(db, { webhookConfigId: "cfg-1" })).toBe(
      1
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      userId: "sysadmin",
      tenantId: undefined,
    });
  });

  it("tells the system administrators about a system-level endpoint, with no project", async () => {
    mocks.activeOrSystemAdmins.mockResolvedValue(["sysadmin"]);
    const db = makeDb({
      name: "SCIM audit",
      adapterType: "GENERIC_HMAC",
      projectId: -1,
    });

    expect(await notifyEndpointDisabled(db, { webhookConfigId: "cfg-2" })).toBe(
      1
    );
    expect(mocks.projectAdminIds).not.toHaveBeenCalled();
    expect(db.projects.findUnique).not.toHaveBeenCalled();
    expect(mocks.activeOrSystemAdmins).toHaveBeenCalledWith(db, []);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      userId: "sysadmin",
      endpointName: "SCIM audit",
      projectId: null,
      projectName: "",
    });
  });

  it("names an endpoint without a name by its kind, and a missing project by nothing", async () => {
    const db = makeDb(
      { name: "  ", adapterType: "GENERIC_HMAC", projectId: 7 },
      null
    );

    await notifyEndpointDisabled(db, { webhookConfigId: "cfg-3" });

    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      endpointName: "GENERIC_HMAC",
      projectName: "",
    });

    mocks.create.mockClear();
    await notifyEndpointDisabled(
      makeDb({ name: null, adapterType: "SLACK", projectId: 7 }),
      { webhookConfigId: "cfg-4" }
    );
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      endpointName: "SLACK",
    });
  });

  it("tells nobody when the endpoint is gone or nobody is left to tell", async () => {
    expect(
      await notifyEndpointDisabled(makeDb(null), { webhookConfigId: "gone" })
    ).toBe(0);
    expect(mocks.activeOrSystemAdmins).not.toHaveBeenCalled();

    mocks.activeOrSystemAdmins.mockResolvedValue([]);
    expect(
      await notifyEndpointDisabled(
        makeDb({ name: "Release channel", adapterType: "SLACK", projectId: 7 }),
        { webhookConfigId: "cfg-1" }
      )
    ).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
