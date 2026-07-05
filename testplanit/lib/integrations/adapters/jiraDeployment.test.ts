import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthHeader,
  detectJiraDeployment,
  pickUserId,
  resolveAuthScheme,
  userRefField,
} from "./jiraDeployment";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("jiraDeployment", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("detectJiraDeployment", () => {
    it("detects Cloud via serverInfo deploymentType", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deploymentType: "Cloud",
          version: "1000.0.0",
        }),
      });
      const result = await detectJiraDeployment("https://example.atlassian.net");
      expect(result).toEqual({ type: "cloud", apiVersion: "3" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/2/serverInfo",
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it("detects Server via serverInfo deploymentType", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deploymentType: "Server",
          version: "10.3.13",
        }),
      });
      const result = await detectJiraDeployment("https://jira.mycompany.domain");
      expect(result).toEqual({ type: "server", apiVersion: "2" });
    });

    it('treats "Data Center" deploymentType as server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentType: "Data Center" }),
      });
      const result = await detectJiraDeployment("https://jira.mycompany.domain");
      expect(result).toEqual({ type: "server", apiVersion: "2" });
    });

    it("falls back to hostname heuristic when serverInfo fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: "Not Found" });
      const cloud = await detectJiraDeployment("https://example.atlassian.net");
      expect(cloud).toEqual({ type: "cloud", apiVersion: "3" });

      mockFetch.mockResolvedValueOnce({ ok: false, statusText: "Not Found" });
      const server = await detectJiraDeployment("https://jira.mycompany.domain");
      expect(server).toEqual({ type: "server", apiVersion: "2" });
    });

    it("falls back to server when serverInfo throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network down"));
      const result = await detectJiraDeployment("https://jira.mycompany.domain");
      expect(result).toEqual({ type: "server", apiVersion: "2" });
    });

    it("strips a trailing slash before probing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentType: "Server" }),
      });
      await detectJiraDeployment("https://jira.mycompany.domain/");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://jira.mycompany.domain/rest/api/2/serverInfo",
        expect.any(Object)
      );
    });
  });

  describe("resolveAuthScheme", () => {
    it("returns bearer for a bare PAT (apiToken, no email/username)", () => {
      expect(resolveAuthScheme({ apiToken: "pat-123" })).toBe("bearer");
    });

    it("returns basic for Cloud email + apiToken", () => {
      expect(
        resolveAuthScheme({ email: "user@example.com", apiToken: "token" })
      ).toBe("basic");
    });

    it("returns basic for Data Center username + password", () => {
      expect(resolveAuthScheme({ username: "user", password: "pass" })).toBe(
        "basic"
      );
    });

    it("honors an explicit bearer override even with an email", () => {
      expect(
        resolveAuthScheme(
          { email: "user@example.com", apiToken: "token" },
          "bearer"
        )
      ).toBe("bearer");
    });

    it("honors an explicit basic override even for a bare PAT", () => {
      expect(resolveAuthScheme({ apiToken: "pat" }, "basic")).toBe("basic");
    });
  });

  describe("buildAuthHeader", () => {
    it("builds a Bearer header for a PAT", () => {
      expect(buildAuthHeader({ apiToken: "pat-123" }, "bearer")).toBe(
        "Bearer pat-123"
      );
    });

    it("builds a Basic header for email + apiToken (Cloud)", () => {
      const header = buildAuthHeader(
        { email: "user@example.com", apiToken: "token" },
        "basic"
      );
      expect(header).toMatch(/^Basic /);
      expect(
        Buffer.from(header.slice(6), "base64").toString("utf8")
      ).toBe("user@example.com:token");
    });

    it("builds a Basic header for username + password (Data Center)", () => {
      const header = buildAuthHeader(
        { username: "user", password: "pass" },
        "basic"
      );
      expect(
        Buffer.from(header.slice(6), "base64").toString("utf8")
      ).toBe("user:pass");
    });
  });

  describe("pickUserId / userRefField", () => {
    it("picks accountId on Cloud", () => {
      expect(pickUserId({ accountId: "a-1", name: "alice" }, "cloud")).toBe(
        "a-1"
      );
    });

    it("picks name (then key) on Server", () => {
      expect(pickUserId({ accountId: "a-1", name: "alice" }, "server")).toBe(
        "alice"
      );
      expect(pickUserId({ key: "alice", accountId: "a-1" }, "server")).toBe(
        "alice"
      );
    });

    it("builds { accountId } for Cloud reporter", () => {
      expect(userRefField({ accountId: "a-1" }, "cloud")).toEqual({
        accountId: "a-1",
      });
    });

    it("builds { name } for Server reporter", () => {
      expect(userRefField({ accountId: "a-1", name: "alice" }, "server")).toEqual(
        { name: "alice" }
      );
    });

    it("returns undefined for a missing user", () => {
      expect(pickUserId(null, "cloud")).toBeUndefined();
      expect(userRefField(undefined, "server")).toBeUndefined();
    });
  });
});
