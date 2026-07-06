import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJiraAuthHeader,
  detectJiraDeployment,
  jiraApiVersion,
  jiraUserId,
  jiraUserRef,
  resolveJiraDeployment,
} from "./jiraDeployment";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const decodeBasic = (header: string) =>
  Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");

describe("jiraDeployment", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveJiraDeployment", () => {
    it("returns server only for an explicit 'server'", () => {
      expect(resolveJiraDeployment("server")).toBe("server");
    });

    it("defaults everything else to cloud (legacy integrations have no setting)", () => {
      expect(resolveJiraDeployment("cloud")).toBe("cloud");
      expect(resolveJiraDeployment(undefined)).toBe("cloud");
      expect(resolveJiraDeployment(null)).toBe("cloud");
      expect(resolveJiraDeployment("")).toBe("cloud");
      expect(resolveJiraDeployment("SERVER")).toBe("cloud");
      expect(resolveJiraDeployment(42)).toBe("cloud");
    });
  });

  describe("jiraApiVersion", () => {
    it("maps cloud to v3 and server to v2", () => {
      expect(jiraApiVersion("cloud")).toBe("3");
      expect(jiraApiVersion("server")).toBe("2");
    });
  });

  describe("buildJiraAuthHeader", () => {
    it("builds Basic email:apiToken on cloud", () => {
      const header = buildJiraAuthHeader("cloud", {
        email: "user@example.com",
        apiToken: "token-1",
      });
      expect(header).toMatch(/^Basic /);
      expect(decodeBasic(header)).toBe("user@example.com:token-1");
    });

    it("builds Bearer for a PAT on server", () => {
      expect(buildJiraAuthHeader("server", { apiToken: "pat-1" })).toBe(
        "Bearer pat-1"
      );
    });

    it("builds Basic username:password on server", () => {
      const header = buildJiraAuthHeader("server", {
        username: "alice",
        password: "s3cret",
      });
      expect(decodeBasic(header)).toBe("alice:s3cret");
    });

    it("prefers username+password over a stray apiToken on server", () => {
      const header = buildJiraAuthHeader("server", {
        username: "alice",
        password: "s3cret",
        apiToken: "leftover",
      });
      expect(decodeBasic(header)).toBe("alice:s3cret");
    });

    it("sends a PAT as Bearer on server even when an email is present", () => {
      // A Data Center PAT is never valid as the Basic password half —
      // exactly the misconfiguration reported in #494.
      expect(
        buildJiraAuthHeader("server", {
          email: "user@example.com",
          apiToken: "pat-1",
        })
      ).toBe("Bearer pat-1");
    });

    it("throws an actionable error when server credentials are missing", () => {
      expect(() =>
        buildJiraAuthHeader("server", { email: "user@example.com" })
      ).toThrow(/Personal Access Token or a username and password/);
    });

    it("throws an actionable error when cloud credentials are incomplete", () => {
      expect(() => buildJiraAuthHeader("cloud", { apiToken: "t" })).toThrow(
        /email and an API token/
      );
      expect(() =>
        buildJiraAuthHeader("cloud", { email: "user@example.com" })
      ).toThrow(/email and an API token/);
    });
  });

  describe("jiraUserId", () => {
    it("picks accountId on cloud", () => {
      expect(jiraUserId({ accountId: "a-1", name: "alice" }, "cloud")).toBe(
        "a-1"
      );
    });

    it("picks name, then key, on server", () => {
      expect(jiraUserId({ accountId: "a-1", name: "alice" }, "server")).toBe(
        "alice"
      );
      expect(jiraUserId({ key: "JIRAUSER1", accountId: "a-1" }, "server")).toBe(
        "JIRAUSER1"
      );
    });

    it("returns undefined for missing users", () => {
      expect(jiraUserId(null, "cloud")).toBeUndefined();
      expect(jiraUserId(undefined, "server")).toBeUndefined();
      expect(jiraUserId({}, "server")).toBeUndefined();
    });
  });

  describe("jiraUserRef", () => {
    it("builds { id } on cloud and { name } on server", () => {
      expect(jiraUserRef("a-1", "cloud")).toEqual({ id: "a-1" });
      expect(jiraUserRef("alice", "server")).toEqual({ name: "alice" });
    });
  });

  describe("detectJiraDeployment", () => {
    it("detects cloud from serverInfo deploymentType", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentType: "Cloud", version: "1001.0.0" }),
      });
      await expect(
        detectJiraDeployment("https://example.atlassian.net")
      ).resolves.toEqual({ deploymentType: "cloud", version: "1001.0.0" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/2/serverInfo",
        expect.objectContaining({ redirect: "manual" })
      );
    });

    it("detects server from serverInfo deploymentType and strips trailing slashes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentType: "Server", version: "10.3.13" }),
      });
      await expect(
        detectJiraDeployment("https://jira.example.com/")
      ).resolves.toEqual({ deploymentType: "server", version: "10.3.13" });
      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://jira.example.com/rest/api/2/serverInfo"
      );
    });

    it("returns null when the probe fails or the body is unrecognizable", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 302 });
      await expect(
        detectJiraDeployment("https://jira.example.com")
      ).resolves.toBeNull();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ something: "else" }),
      });
      await expect(
        detectJiraDeployment("https://jira.example.com")
      ).resolves.toBeNull();

      mockFetch.mockRejectedValueOnce(new Error("network down"));
      await expect(
        detectJiraDeployment("https://jira.example.com")
      ).resolves.toBeNull();
    });
  });
});
