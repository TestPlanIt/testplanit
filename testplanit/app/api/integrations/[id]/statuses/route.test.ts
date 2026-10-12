import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    integration: { findUnique: vi.fn() },
    userIntegrationAuth: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: vi.fn(),
  },
}));

import { baseDb } from "@/lib/db";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { getServerSession } from "next-auth/next";

import { GET } from "./route";

const createRequest = (projectKey?: string): NextRequest => {
  const url = new URL("http://localhost/api/integrations/7/statuses");
  if (projectKey !== undefined) url.searchParams.set("projectKey", projectKey);
  return new NextRequest(url.toString());
};

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

const mockSession = { user: { id: "user-1" } };

const findUnique = baseDb.integration.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const findFirst = baseDb.userIntegrationAuth.findFirst as unknown as ReturnType<
  typeof vi.fn
>;

let getAdapter: ReturnType<typeof vi.fn>;
let getStatuses: ReturnType<typeof vi.fn>;

describe("GET /api/integrations/[id]/statuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (getServerSession as any).mockResolvedValue(mockSession);
    getStatuses = vi.fn().mockResolvedValue([{ id: "1", name: "To Do" }]);
    getAdapter = vi.fn().mockResolvedValue({ getStatuses });
    (IntegrationManager.getInstance as any).mockReturnValue({ getAdapter });
    findUnique.mockResolvedValue({
      id: 7,
      provider: "JIRA",
      authType: "API_KEY",
      status: "ACTIVE",
    });
    findFirst.mockResolvedValue({ id: 1 });
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const response = await GET(createRequest(), paramsFor("7"));
    expect(response.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no user id", async () => {
    (getServerSession as any).mockResolvedValue({ user: {} });
    const response = await GET(createRequest(), paramsFor("7"));
    expect(response.status).toBe(401);
  });

  it.each(["abc", "1.5"])(
    "returns 404 for a non-integer id %j without querying",
    async (id) => {
      const response = await GET(createRequest(), paramsFor(id));
      expect(response.status).toBe(404);
      expect(findUnique).not.toHaveBeenCalled();
    }
  );

  it("returns 404 for a missing or inactive integration", async () => {
    findUnique.mockResolvedValue(null);
    const response = await GET(createRequest(), paramsFor("7"));
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data.error).toBe("Integration not found or inactive");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 7, status: "ACTIVE" },
    });
  });

  it.each([
    ["GITHUB", "open"],
    ["GITEA", "open"],
    ["GITLAB", "opened"],
  ])(
    "answers %s's fixed statuses without credentials or the adapter",
    async (provider, openName) => {
      findUnique.mockResolvedValue({
        id: 7,
        provider,
        authType: "OAUTH2",
        status: "ACTIVE",
      });
      findFirst.mockResolvedValue(null);

      const response = await GET(createRequest("owner/repo"), paramsFor("7"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.statuses).toEqual([
        { id: openName, name: openName },
        { id: "closed", name: "closed" },
      ]);
      expect(findFirst).not.toHaveBeenCalled();
      expect(IntegrationManager.getInstance).not.toHaveBeenCalled();
    }
  );

  it("returns 401 for an OAUTH2 integration without active user auth", async () => {
    findUnique.mockResolvedValue({
      id: 7,
      provider: "JIRA",
      authType: "OAUTH2",
      status: "ACTIVE",
    });
    findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), paramsFor("7"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("User authentication required");
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", integrationId: 7, isActive: true },
    });
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("proceeds for an OAUTH2 integration with active user auth", async () => {
    findUnique.mockResolvedValue({
      id: 7,
      provider: "JIRA",
      authType: "OAUTH2",
      status: "ACTIVE",
    });
    const response = await GET(createRequest(), paramsFor("7"));
    expect(response.status).toBe(200);
    expect(getAdapter).toHaveBeenCalledWith("7");
  });

  it("does not check user auth for non-OAUTH2 integrations", async () => {
    await GET(createRequest(), paramsFor("7"));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns 500 when the adapter cannot be initialized", async () => {
    getAdapter.mockResolvedValue(null);
    const response = await GET(createRequest(), paramsFor("7"));
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to initialize integration adapter");
  });

  it("returns an empty list when the adapter cannot list statuses", async () => {
    getAdapter.mockResolvedValue({});
    const response = await GET(createRequest("PROJ"), paramsFor("7"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ statuses: [] });
  });

  it("passes the projectKey query param to the adapter", async () => {
    const response = await GET(createRequest("PROJ"), paramsFor("7"));
    expect(response.status).toBe(200);
    expect(getStatuses).toHaveBeenCalledWith("PROJ");
    expect(await response.json()).toEqual({
      statuses: [{ id: "1", name: "To Do" }],
    });
  });

  it("passes undefined when projectKey is absent or empty", async () => {
    await GET(createRequest(), paramsFor("7"));
    expect(getStatuses).toHaveBeenLastCalledWith(undefined);
    await GET(createRequest(""), paramsFor("7"));
    expect(getStatuses).toHaveBeenLastCalledWith(undefined);
  });

  it("returns 500 when the adapter throws", async () => {
    getStatuses.mockRejectedValue(new Error("boom"));
    const response = await GET(createRequest("PROJ"), paramsFor("7"));
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch statuses");
  });

  it("returns 500 when the integration lookup throws", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const response = await GET(createRequest(), paramsFor("7"));
    expect(response.status).toBe(500);
  });
});
