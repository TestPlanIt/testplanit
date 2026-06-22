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
