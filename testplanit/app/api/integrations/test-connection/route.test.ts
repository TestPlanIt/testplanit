import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route handler
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integration: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/utils/encryption", () => ({
  decrypt: vi.fn(),
  isEncrypted: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { decrypt, isEncrypted } from "@/utils/encryption";
import { getServerSession } from "next-auth";

import { POST } from "./route";

const createRequest = (body: Record<string, any> = {}): NextRequest => {
  return new NextRequest("http://localhost/api/integrations/test-connection", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

const mockSession = {
  user: { id: "user-1", name: "Test User" },
};

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("POST /api/integrations/test-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    (isEncrypted as any).mockReturnValue(false);
    (decrypt as any).mockImplementation((val: string) => Promise.resolve(val));
    (prisma.integration.update as any).mockResolvedValue({});
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST(
        createRequest({
          provider: "SIMPLE_URL",
          settings: { baseUrl: "https://example.com/{issueId}" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const response = await POST(
        createRequest({
          provider: "SIMPLE_URL",
          settings: { baseUrl: "https://example.com/{issueId}" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Provider validation", () => {
    it("returns 400 when no provider and no integrationId", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Provider not specified");
    });
  });

  describe("SIMPLE_URL provider", () => {
    it("returns success when URL contains {issueId} placeholder", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "SIMPLE_URL",
          settings: { baseUrl: "https://issues.example.com/{issueId}" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("returns failure when URL does not contain {issueId} placeholder", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "SIMPLE_URL",
          settings: { baseUrl: "https://issues.example.com/browse" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("{issueId}");
    });

    it("returns failure when no baseUrl provided", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "SIMPLE_URL",
          settings: {},
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("URL");
    });
  });

  describe("JIRA provider", () => {
    it("returns success when Jira API returns 200 for API_KEY auth and all scope probes pass", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      // Three probes per provider now: connection (/myself) +
      // searchIssues (/search) + readIssue (/issue/picker). All
      // succeed → success=true with capabilities populated.
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "JIRA",
          authType: "API_KEY",
          credentials: { email: "user@example.com", apiToken: "token123" },
          settings: { baseUrl: "https://mycompany.atlassian.net" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.capabilities?.connection?.ok).toBe(true);
      expect(data.capabilities?.searchIssues?.ok).toBe(true);
      expect(data.capabilities?.readIssue?.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://mycompany.atlassian.net/rest/api/3/myself",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic "),
          }),
        })
      );
    });

    it("returns failure when Jira API returns 401", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      // Connection probe fails → route returns early without running
      // searchIssues / readIssue probes, so a single mock is enough.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "JIRA",
          authType: "API_KEY",
          credentials: { email: "user@example.com", apiToken: "bad-token" },
          settings: { baseUrl: "https://mycompany.atlassian.net" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("401");
    });

    it("returns a clear error for a bare API token against Jira Cloud (no email/username)", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      // v3 /myself -> rejected (a bare token was guessed as Bearer, which
      // Cloud's API-key auth does not accept).
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      });
      // serverInfo probe (same bad header) also fails -> detection falls to
      // the hostname heuristic, which still resolves *.atlassian.net as cloud.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "JIRA",
          authType: "API_KEY",
          credentials: { apiToken: "bare-token" },
          settings: { baseUrl: "https://mycompany.atlassian.net" },
        })
      );
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toContain(
        "Jira Cloud authentication requires an email address paired with the API token"
      );
    });

    it("returns failure when Jira API_KEY missing required fields", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "JIRA",
          authType: "API_KEY",
          credentials: { email: "user@example.com" }, // missing apiToken
          settings: { baseUrl: "https://mycompany.atlassian.net" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("apiToken");
    });

    it("returns requiresUserAuth (not a probe failure) for OAUTH2 with client credentials present", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "JIRA",
          authType: "OAUTH2",
          credentials: { clientId: "abc", clientSecret: "shh" },
          settings: { baseUrl: "https://mycompany.atlassian.net" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.requiresUserAuth).toBe(true);
      // OAuth client creds can't be exercised from the admin side — no
      // upstream call should be attempted (the old code probed Atlassian
      // with the client secret as a bearer token, which always failed).
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns failure for OAUTH2 when client credentials are missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "JIRA",
          authType: "OAUTH2",
          credentials: { clientId: "abc" }, // missing clientSecret
          settings: { baseUrl: "https://mycompany.atlassian.net" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("clientSecret");
    });

    it("does NOT mark a saved OAUTH2 integration ACTIVE on a passing test", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 7,
        provider: "JIRA",
        authType: "OAUTH2",
        credentials: { clientId: "abc", clientSecret: "shh" },
        settings: { baseUrl: "https://mycompany.atlassian.net" },
      });

      const response = await POST(createRequest({ integrationId: 7 }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.requiresUserAuth).toBe(true);
      // Activation for OAuth happens only in the authorization callback once
      // a real user token exists — never from the admin-side test.
      expect(prisma.integration.update).not.toHaveBeenCalled();
    });
  });

  describe("GITHUB provider", () => {
    it("returns success when GitHub API returns 200 and all scope probes pass", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      // /user (auth) + /search/issues (search scope) + /issues (read scope).
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "GITHUB",
          credentials: { personalAccessToken: "ghp_token123" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.capabilities?.searchIssues?.ok).toBe(true);
      expect(data.capabilities?.readIssue?.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token ghp_token123",
          }),
        })
      );
    });

    it("returns failure when GitHub /user returns 401", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "GITHUB",
          credentials: { personalAccessToken: "invalid-token" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("401");
    });

    it("returns failure when no personalAccessToken", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "GITHUB",
          credentials: {},
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("personal access token");
    });

    it("probes the GitHub Enterprise Server base URL when settings.baseUrl is provided", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "GITHUB",
          credentials: { personalAccessToken: "ghp_token123" },
          settings: { baseUrl: "https://github.example.com/api/v3" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Auth probe + search probe + read probe all hit the GHES host
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.example.com/api/v3/user",
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.example.com/api/v3/search/issues?q=is:issue&per_page=1",
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.example.com/api/v3/issues?per_page=1&filter=all&state=open",
        expect.any(Object)
      );
      // And no probe leaked to public github.com
      const calledUrls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(
        calledUrls.some((u: string) => u.startsWith("https://api.github.com"))
      ).toBe(false);
    });

    it("normalizes a trailing slash on settings.baseUrl", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      });

      await POST(
        createRequest({
          provider: "GITHUB",
          credentials: { personalAccessToken: "ghp_token123" },
          settings: { baseUrl: "https://github.example.com/api/v3/" },
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.example.com/api/v3/user",
        expect.any(Object)
      );
    });
  });

  describe("AZURE_DEVOPS provider", () => {
    it("returns success when Azure DevOps API returns 200 and all scope probes pass", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      // /_apis/projects (auth) + /_apis/wit/wiql (search) + /_apis/wit/workitems (read).
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "AZURE_DEVOPS",
          credentials: { personalAccessToken: "azure-pat" },
          settings: { organizationUrl: "https://dev.azure.com/myorg" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.capabilities?.searchIssues?.ok).toBe(true);
      expect(data.capabilities?.readIssue?.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://dev.azure.com/myorg/_apis/projects?api-version=6.0",
        expect.anything()
      );
    });

    it("returns failure when Azure DevOps API returns 401", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      });

      const response = await POST(
        createRequest({
          provider: "AZURE_DEVOPS",
          credentials: { personalAccessToken: "bad-pat" },
          settings: { organizationUrl: "https://dev.azure.com/myorg" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("401");
    });

    it("returns failure when Azure DevOps missing required fields", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          provider: "AZURE_DEVOPS",
          credentials: {}, // missing personalAccessToken
          settings: { organizationUrl: "https://dev.azure.com/myorg" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Azure DevOps");
    });
  });

  describe("Testing existing integration by integrationId", () => {
    it("looks up integration from DB and decrypts credentials", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 5,
        provider: "GITHUB",
        authType: "PERSONAL_ACCESS_TOKEN",
        credentials: { personalAccessToken: "encrypted-value" },
        settings: {},
      });
      (isEncrypted as any).mockReturnValue(true);
      (decrypt as any).mockResolvedValue("decrypted-token");
      // GitHub provider runs three probes; all succeed.
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      });

      const response = await POST(createRequest({ integrationId: 5 }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(decrypt).toHaveBeenCalledWith("encrypted-value");
    });

    it("returns 404 when integration not found by id", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.integration.findUnique as any).mockResolvedValue(null);

      const response = await POST(createRequest({ integrationId: 999 }));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });

    it("updates integration status to ACTIVE on success", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 5,
        provider: "SIMPLE_URL",
        authType: "NONE",
        credentials: {},
        settings: { baseUrl: "https://example.com/{issueId}" },
      });

      const response = await POST(createRequest({ integrationId: 5 }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prisma.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: expect.objectContaining({ status: "ACTIVE" }),
        })
      );
    });
  });
});

describe("POST /api/integrations/test-connection — Jira Data Center", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.integration.update as any).mockResolvedValue({});
  });

  it("auto-detects Data Center and authenticates a PAT as Bearer on /rest/api/2", async () => {
    // v3 /myself -> 404 (Data Center has no v3)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    // serverInfo -> Server
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deploymentType: "Server", version: "10.3.13" }),
    });
    // v2 /myself -> ok
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    // v2 /search -> ok
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ issues: [] }) });
    // v2 /issue/picker -> ok
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const response = await POST(
      createRequest({
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { apiToken: "pat-123" },
        settings: { baseUrl: "https://jira.mycompany.domain" },
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.capabilities?.connection?.ok).toBe(true);
    expect(data.capabilities?.searchIssues?.ok).toBe(true);
    expect(data.capabilities?.readIssue?.ok).toBe(true);

    // v3 was attempted first, then v2.
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://jira.mycompany.domain/rest/api/3/myself"
    );
    const calledUrls = mockFetch.mock.calls.map((c: any[]) => c[0]);
    expect(calledUrls).toContain("https://jira.mycompany.domain/rest/api/2/myself");
    expect(calledUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("https://jira.mycompany.domain/rest/api/2/search?"),
      ])
    );
    expect(calledUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("https://jira.mycompany.domain/rest/api/2/issue/picker"),
      ])
    );
    // Every Jira call must use Bearer (PAT, no email).
    for (const call of mockFetch.mock.calls) {
      const auth = (call[1] as any)?.headers?.Authorization;
      expect(auth).toBe("Bearer pat-123");
    }
  });

  it("authenticates Data Center Basic (username + password) on /rest/api/2", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deploymentType: "Server" }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ issues: [] }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const response = await POST(
      createRequest({
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { username: "alice", password: "secret" },
        settings: { baseUrl: "https://jira.mycompany.domain" },
      })
    );
    const data = await response.json();

    expect(data.success).toBe(true);
    const myselfCall = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "https://jira.mycompany.domain/rest/api/2/myself"
    );
    expect(myselfCall).toBeTruthy();
    const auth = (myselfCall![1] as any).headers.Authorization;
    expect(auth).toMatch(/^Basic /);
    expect(Buffer.from(auth.slice(6), "base64").toString("utf8")).toBe(
      "alice:secret"
    );
  });

  it("honors an explicit settings.deploymentType=server and skips the v3 probe", async () => {
    // No v3 call should happen — server override probes v2 directly.
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const response = await POST(
      createRequest({
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { email: "alice", apiToken: "secret" },
        settings: {
          baseUrl: "https://jira.mycompany.domain",
          deploymentType: "server",
        },
      })
    );
    const data = await response.json();

    expect(data.success).toBe(true);
    const calledUrls = mockFetch.mock.calls.map((c: any[]) => c[0]);
    expect(calledUrls).not.toContain(
      "https://jira.mycompany.domain/rest/api/3/myself"
    );
    expect(calledUrls).toContain("https://jira.mycompany.domain/rest/api/2/myself");
    expect(calledUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("https://jira.mycompany.domain/rest/api/2/search?"),
      ])
    );
  });

  it("uses Bearer for an email + PAT combo on Data Center (not Basic)", async () => {
    // Reproduces the user's report: email supplied alongside a PAT. The v3
    // probe 404s (DC has no v3); after detection the v2 probe must use
    // Bearer, not Basic email:PAT (which Jira DC rejects with 401).
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deploymentType: "Server" }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ issues: [] }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const response = await POST(
      createRequest({
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { email: "testplanit@rapidsoft.ru", apiToken: "pat-123" },
        settings: { baseUrl: "https://jira.rapidsoft.ru" },
      })
    );
    const data = await response.json();

    expect(data.success).toBe(true);
    const myselfCall = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "https://jira.rapidsoft.ru/rest/api/2/myself"
    );
    expect(myselfCall).toBeTruthy();
    expect((myselfCall![1] as any).headers.Authorization).toBe("Bearer pat-123");
  });

  it("detects Data Center when v3 /myself redirects to the login page (302→opaque)", async () => {
    // Reproduces jira.rapidsoft.ru: /rest/api/3/myself returns 302 (redirect
    // to login.jsp). With redirect: "manual" the probe sees a non-OK opaque
    // response (status 0) instead of a misleading 200, so detection falls
    // through to serverInfo → Server, and the v2 probe authenticates.
    // v3 /myself → opaque redirect (non-OK, status 0)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 0,
      statusText: "",
      json: async () => ({}),
    });
    // serverInfo → Server (hostname fallback would also work, but here the
    // instance returns deploymentType on a 401-fallback path)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deploymentType: "Server" }),
    });
    // v2 /myself, /search, /issue/picker
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ issues: [] }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const response = await POST(
      createRequest({
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { apiToken: "pat-123" },
        settings: { baseUrl: "https://jira.rapidsoft.ru" },
      })
    );
    const data = await response.json();

    expect(data.success).toBe(true);
    // The v3 probe must have used redirect: "manual".
    const v3Call = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "https://jira.rapidsoft.ru/rest/api/3/myself"
    );
    expect(v3Call).toBeTruthy();
    expect((v3Call![1] as any).redirect).toBe("manual");
    const calledUrls = mockFetch.mock.calls.map((c: any[]) => c[0]);
    expect(calledUrls).toContain("https://jira.rapidsoft.ru/rest/api/2/myself");
  });

  describe("D4: persists resolved deploymentType/authScheme", () => {
    beforeEach(() => {
      (isEncrypted as any).mockReturnValue(false);
    });

    it("fills in deploymentType/authScheme on a successful test when unset", async () => {
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 42,
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { apiToken: "pat-123" },
        settings: { baseUrl: "https://jira.mycompany.domain" },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentType: "Server" }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ issues: [] }) });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

      const response = await POST(createRequest({ integrationId: 42 }));
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(prisma.integration.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: expect.objectContaining({
          status: "ACTIVE",
          settings: expect.objectContaining({
            baseUrl: "https://jira.mycompany.domain",
            deploymentType: "server",
            authScheme: "bearer",
          }),
        }),
      });
    });

    it("never overwrites already-resolved settings keys (fill-missing-only)", async () => {
      // deploymentType=server is an explicit override, so the route skips
      // v3/serverInfo detection entirely and probes v2 directly.
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 43,
        provider: "JIRA",
        authType: "API_KEY",
        credentials: { apiToken: "pat-123" },
        settings: {
          baseUrl: "https://jira.mycompany.domain",
          deploymentType: "server",
          authScheme: "bearer",
          customSetting: "must-survive",
        },
      });

      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const response = await POST(createRequest({ integrationId: 43 }));
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(prisma.integration.update).toHaveBeenCalledWith({
        where: { id: 43 },
        data: expect.objectContaining({
          settings: expect.objectContaining({
            baseUrl: "https://jira.mycompany.domain",
            deploymentType: "server",
            authScheme: "bearer",
            customSetting: "must-survive",
          }),
        }),
      });
    });
  });
});
