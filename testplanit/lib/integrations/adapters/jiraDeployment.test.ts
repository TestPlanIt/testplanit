import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthHeader,
  detectJiraDeployment,
  jiraConnectionChanged,
  mapCustomFieldUserRefs,
  mergeJiraCredentials,
  pickUserId,
  resolveAuthScheme,
  userRefField,
  withoutJiraDetectedSettings,
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
      const result = await detectJiraDeployment(
        "https://example.atlassian.net"
      );
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
      const result = await detectJiraDeployment(
        "https://jira.mycompany.domain"
      );
      expect(result).toEqual({ type: "server", apiVersion: "2" });
    });

    it('treats "Data Center" deploymentType as server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentType: "Data Center" }),
      });
      const result = await detectJiraDeployment(
        "https://jira.mycompany.domain"
      );
      expect(result).toEqual({ type: "server", apiVersion: "2" });
    });

    it("falls back to hostname heuristic when serverInfo fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: "Not Found" });
      const cloud = await detectJiraDeployment("https://example.atlassian.net");
      expect(cloud).toEqual({ type: "cloud", apiVersion: "3" });

      mockFetch.mockResolvedValueOnce({ ok: false, statusText: "Not Found" });
      const server = await detectJiraDeployment(
        "https://jira.mycompany.domain"
      );
      expect(server).toEqual({ type: "server", apiVersion: "2" });
    });

    it("falls back to server when serverInfo throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network down"));
      const result = await detectJiraDeployment(
        "https://jira.mycompany.domain"
      );
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

    it("treats an email + PAT as Bearer on Server/Data Center", () => {
      // The user's case: email supplied alongside a PAT. On DC the PAT is
      // always Bearer — Jira DC rejects a PAT as the Basic password half.
      expect(
        resolveAuthScheme(
          { email: "testplanit@rapidsoft.ru", apiToken: "pat-123" },
          undefined,
          "server"
        )
      ).toBe("bearer");
    });

    it("treats username + password as Basic on Server/Data Center", () => {
      expect(
        resolveAuthScheme(
          { username: "alice", password: "secret" },
          undefined,
          "server"
        )
      ).toBe("basic");
    });

    it("treats email + apiToken as Basic on Cloud", () => {
      expect(
        resolveAuthScheme(
          { email: "user@example.com", apiToken: "token" },
          undefined,
          "cloud"
        )
      ).toBe("basic");
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
      expect(Buffer.from(header.slice(6), "base64").toString("utf8")).toBe(
        "user@example.com:token"
      );
    });

    it("builds a Basic header for username + password (Data Center)", () => {
      const header = buildAuthHeader(
        { username: "user", password: "pass" },
        "basic"
      );
      expect(Buffer.from(header.slice(6), "base64").toString("utf8")).toBe(
        "user:pass"
      );
    });
  });

  describe("buildAuthHeader on Server/Data Center", () => {
    const decode = (header: string) =>
      Buffer.from(header.slice(6), "base64").toString("utf8");

    it("prefers username + password over a stale email + API token", () => {
      const header = buildAuthHeader(
        {
          email: "alice@example.com",
          apiToken: "old-token",
          username: "alice",
          password: "secret",
        },
        "basic",
        "server"
      );
      expect(decode(header)).toBe("alice:secret");
    });

    it("treats blank values as absent", () => {
      expect(
        decode(
          buildAuthHeader(
            { email: "", username: "alice", apiToken: "", password: "secret" },
            "basic"
          )
        )
      ).toBe("alice:secret");
      expect(
        buildAuthHeader({ apiToken: "", password: "pat-1" }, "bearer")
      ).toBe("Bearer pat-1");
    });

    it("keeps Cloud's email + API token pairing", () => {
      const header = buildAuthHeader(
        {
          email: "alice@example.com",
          apiToken: "token",
          username: "alice",
          password: "secret",
        },
        "basic",
        "cloud"
      );
      expect(decode(header)).toBe("alice@example.com:token");
    });
  });

  describe("mapCustomFieldUserRefs", () => {
    it("maps a multi-user field's refs to { name } on Server", () => {
      expect(
        mapCustomFieldUserRefs(
          {
            customfield_1: [{ accountId: "alice" }, { accountId: "bob" }],
            customfield_2: [{ id: "10" }],
            labels: [],
          },
          "server"
        )
      ).toEqual({
        customfield_1: [{ name: "alice" }, { name: "bob" }],
        customfield_2: [{ id: "10" }],
        labels: [],
      });
    });
  });

  describe("mergeJiraCredentials", () => {
    it("replaces a stored email + API token with an entered username + password", () => {
      expect(
        mergeJiraCredentials(
          { email: "alice@example.com", apiToken: "old-token" },
          { username: "alice", password: "secret" }
        )
      ).toEqual({ username: "alice", password: "secret" });
    });

    it("replaces a stored password with an entered PAT and keeps the user", () => {
      expect(
        mergeJiraCredentials(
          { username: "alice", password: "secret" },
          { apiToken: "pat-1" }
        )
      ).toEqual({ username: "alice", apiToken: "pat-1" });
    });

    it("keeps stored values for blank inputs and leaves other keys alone", () => {
      expect(
        mergeJiraCredentials(
          { username: "alice", password: "secret", clientId: "abc" },
          { username: "", password: "" }
        )
      ).toEqual({ username: "alice", password: "secret", clientId: "abc" });
    });
  });

  describe("jiraConnectionChanged / withoutJiraDetectedSettings", () => {
    it("reports a change for entered credentials or a new base URL only", () => {
      expect(jiraConnectionChanged({ password: "x" }, undefined, "a")).toBe(
        true
      );
      expect(jiraConnectionChanged({}, "https://b", "https://a")).toBe(true);
      expect(
        jiraConnectionChanged({ password: "" }, "https://a", "https://a")
      ).toBe(false);
      expect(jiraConnectionChanged(undefined, undefined, "https://a")).toBe(
        false
      );
    });

    it("drops only the detected settings", () => {
      expect(
        withoutJiraDetectedSettings({
          baseUrl: "https://a",
          deploymentType: "server",
          authScheme: "bearer",
        })
      ).toEqual({ baseUrl: "https://a" });
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
      expect(
        userRefField({ accountId: "a-1", name: "alice" }, "server")
      ).toEqual({ name: "alice" });
    });

    it("returns undefined for a missing user", () => {
      expect(pickUserId(null, "cloud")).toBeUndefined();
      expect(userRefField(undefined, "server")).toBeUndefined();
    });
  });
});
