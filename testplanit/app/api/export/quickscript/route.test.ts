import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerAuthSession,
  mockAuthenticateApiTokenForMethod,
  mockExtractBearerToken,
  mockUserHasProjectAccess,
  mockGetQuickScriptReadiness,
  mockResolveQuickScriptTemplate,
  mockFetchQuickScriptCases,
  mockGenerateQuickScript,
} = vi.hoisted(() => ({
  mockGetServerAuthSession: vi.fn(),
  mockAuthenticateApiTokenForMethod: vi.fn(),
  mockExtractBearerToken: vi.fn(),
  mockUserHasProjectAccess: vi.fn(),
  mockGetQuickScriptReadiness: vi.fn(),
  mockResolveQuickScriptTemplate: vi.fn(),
  mockFetchQuickScriptCases: vi.fn(),
  mockGenerateQuickScript: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));
vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiTokenForMethod: mockAuthenticateApiTokenForMethod,
  extractBearerToken: mockExtractBearerToken,
}));
vi.mock("~/lib/services/projectAccess", () => ({
  userHasProjectAccess: mockUserHasProjectAccess,
}));
vi.mock("~/lib/services/quickscript-generation", () => ({
  getQuickScriptReadiness: mockGetQuickScriptReadiness,
  resolveQuickScriptTemplate: mockResolveQuickScriptTemplate,
  fetchQuickScriptCases: mockFetchQuickScriptCases,
  generateQuickScript: mockGenerateQuickScript,
}));

import { POST } from "./route";

const template = {
  id: 3,
  name: "Playwright",
  framework: "Playwright",
  language: "TypeScript",
  fileExtension: ".spec.ts",
};

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL("http://localhost/api/export/quickscript"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

const validBody = { projectId: 1, caseIds: [456] };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated session user with access + ready project.
  mockGetServerAuthSession.mockResolvedValue({
    user: { id: "u1", access: "ADMIN" },
  });
  mockExtractBearerToken.mockReturnValue(null);
  mockUserHasProjectAccess.mockResolvedValue(true);
  mockGetQuickScriptReadiness.mockResolvedValue({
    quickScriptEnabled: true,
    hasActiveLlm: true,
    hasCodeContext: true,
  });
  mockResolveQuickScriptTemplate.mockResolvedValue(template);
  mockFetchQuickScriptCases.mockResolvedValue([
    { id: 456, name: "Login", steps: [] },
  ]);
  mockGenerateQuickScript.mockResolvedValue({
    code: "test('login', () => {});",
    generatedBy: "ai",
    caseId: 456,
    caseName: "Login",
    contextFiles: [],
  });
});

describe("POST /api/export/quickscript", () => {
  it("401 when unauthenticated (no session, no token)", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue(null);

    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("403 when the token is read-only", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);
    mockExtractBearerToken.mockReturnValue("tpi_readonly");
    mockAuthenticateApiTokenForMethod.mockResolvedValue({
      authenticated: false,
      errorCode: "READ_ONLY_TOKEN",
      error: "read only",
    });

    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("READ_ONLY_TOKEN");
  });

  it("404 when the user lacks project access", async () => {
    mockUserHasProjectAccess.mockResolvedValue(false);

    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
    expect(mockGenerateQuickScript).not.toHaveBeenCalled();
  });

  it("403 when QuickScript is not enabled for the project", async () => {
    mockGetQuickScriptReadiness.mockResolvedValue({
      quickScriptEnabled: false,
      hasActiveLlm: true,
      hasCodeContext: false,
    });

    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
    expect(mockGenerateQuickScript).not.toHaveBeenCalled();
  });

  it("400 when no export template resolves", async () => {
    mockResolveQuickScriptTemplate.mockResolvedValue(null);

    const res = await POST(req(validBody));
    expect(res.status).toBe(400);
  });

  it("404 when none of the caseIds are in the project", async () => {
    mockFetchQuickScriptCases.mockResolvedValue([]);

    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("400 on an invalid body (empty caseIds)", async () => {
    const res = await POST(req({ projectId: 1, caseIds: [] }));
    expect(res.status).toBe(400);
  });

  it("200 combined: one result + resolved template metadata", async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.templateId).toBe(3);
    expect(json.framework).toBe("Playwright");
    expect(json.results).toHaveLength(1);
    expect(mockGenerateQuickScript).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "single", userId: "u1" })
    );
  });

  it("perCase: generates one file per case and reports missing ids", async () => {
    mockFetchQuickScriptCases.mockResolvedValue([
      { id: 456, name: "Login", steps: [] },
      { id: 457, name: "Logout", steps: [] },
    ]);

    const res = await POST(
      req({ projectId: 1, caseIds: [456, 457, 999], outputMode: "perCase" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockGenerateQuickScript).toHaveBeenCalledTimes(2);
    expect(json.missingCaseIds).toEqual([999]);
  });
});
