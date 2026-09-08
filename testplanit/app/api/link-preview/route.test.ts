import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadEntityPreview } = vi.hoisted(() => ({
  mockLoadEntityPreview: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ baseDb: {} }));

vi.mock("~/lib/linkPreviewData", () => ({
  loadEntityPreview: mockLoadEntityPreview,
}));

// Echo the key and its values so assertions can pin which message a branch
// chose without depending on the en-US copy.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    return (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${JSON.stringify(values)})` : key;
  }),
}));

import { GET } from "./route";

const ORIGINAL_MODE = process.env.LINK_PREVIEW_MODE;
const ORIGINAL_URL = process.env.NEXTAUTH_URL;

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/link-preview");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

async function html(params: Record<string, string>): Promise<string> {
  const response = await GET(createRequest(params));
  return await response.text();
}

describe("GET /api/link-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = "https://tpi.example.com";
    delete process.env.LINK_PREVIEW_MODE;
  });

  afterEach(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.LINK_PREVIEW_MODE;
    else process.env.LINK_PREVIEW_MODE = ORIGINAL_MODE;
    if (ORIGINAL_URL === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = ORIGINAL_URL;
  });

  describe("safe mode (default)", () => {
    it("never touches the database", async () => {
      await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
        path: "/en-US/projects/runs/5/88",
      });

      expect(mockLoadEntityPreview).not.toHaveBeenCalled();
    });

    it("describes the record kind without naming the record", async () => {
      const body = await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
        path: "/en-US/projects/runs/5/88",
      });

      expect(body).toContain("testRunLabel");
      expect(body).toContain("testRunGeneric");
      expect(body).toContain("genericTitle");
    });

    it("distinguishes the entity kinds from each other", async () => {
      const run = await html({ entity: "test-run", locale: "en-US" });
      const testCase = await html({ entity: "test-case", locale: "en-US" });

      expect(run).toContain("testRunGeneric");
      expect(testCase).toContain("testCaseGeneric");
      expect(run).not.toContain("testCaseGeneric");
    });
  });

  describe("names mode", () => {
    beforeEach(() => {
      process.env.LINK_PREVIEW_MODE = "names";
    });

    it("names the record and its project", async () => {
      mockLoadEntityPreview.mockResolvedValue({
        name: "Regression 24.3",
        projectName: "Acme Web",
        recordKey: null,
        caseCount: 148,
        runCount: null,
      });

      const body = await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
        path: "/en-US/projects/runs/5/88",
      });

      expect(mockLoadEntityPreview).toHaveBeenCalledWith({}, "test-run", 88);
      expect(body).toContain("Regression 24.3");
      expect(body).toContain("Acme Web");
      expect(body).toContain("testRunSummary");
    });

    it("prefixes the display key when record keys are enabled", async () => {
      mockLoadEntityPreview.mockResolvedValue({
        name: "Login with SSO",
        projectName: "Acme Web",
        recordKey: "ACME-TC-1234",
        caseCount: null,
        runCount: null,
      });

      const body = await html({
        entity: "test-case",
        id: "1234",
        locale: "en-US",
      });

      expect(body).toContain("ACME-TC-1234: Login with SSO");
    });

    it("falls back to the generic card for an unreadable record", async () => {
      mockLoadEntityPreview.mockResolvedValue(null);

      const body = await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
      });

      expect(body).toContain("testRunGeneric");
      expect(body).toContain("genericTitle");
    });

    it("skips the lookup when the route carries no record id", async () => {
      await html({ entity: "app", locale: "en-US", path: "/en-US" });
      expect(mockLoadEntityPreview).not.toHaveBeenCalled();
    });

    it("escapes record names so a name cannot inject markup", async () => {
      mockLoadEntityPreview.mockResolvedValue({
        name: '<script>alert("x")</script>',
        projectName: "A & B",
        recordKey: null,
        caseCount: null,
        runCount: null,
      });

      const body = await html({
        entity: "test-case",
        id: "1",
        locale: "en-US",
      });

      expect(body).not.toContain("<script>");
      expect(body).toContain("&lt;script&gt;");
      expect(body).toContain("&amp;");
    });
  });

  describe("card markup", () => {
    it("emits a text-only card with no image tags", async () => {
      const body = await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
        path: "/en-US/projects/runs/5/88",
      });

      expect(body).toContain('name="twitter:card" content="summary"');
      // A card that declares no image must not leave stray image tags behind —
      // a dangling og:image renders as a broken thumbnail in some clients.
      expect(body).not.toContain("og:image");
      expect(body).not.toContain("twitter:image");
    });

    it("points og:url at the shared link, not the preview endpoint", async () => {
      const body = await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
        path: "/en-US/projects/runs/5/88",
      });

      expect(body).toContain(
        'property="og:url" content="https://tpi.example.com/en-US/projects/runs/5/88"'
      );
    });

    it("keeps app deep links out of search indexes", async () => {
      const response = await GET(
        createRequest({ entity: "test-run", id: "88", locale: "en-US" })
      );

      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(await response.text()).toContain(
        'name="robots" content="noindex, nofollow"'
      );
    });

    it("sends a real browser on to sign-in rather than back through the rewrite", async () => {
      const body = await html({
        entity: "test-run",
        id: "88",
        locale: "en-US",
        path: "/en-US/projects/runs/5/88",
      });

      // Refreshing to the original path would loop: proxy.ts would rewrite it
      // straight back here.
      expect(body).toContain(
        'http-equiv="refresh" content="0; url=https://tpi.example.com/en-US/signin"'
      );
    });
  });

  describe("input handling", () => {
    it("falls back to the app card for an unknown entity", async () => {
      const body = await html({ entity: "not-a-thing", locale: "en-US" });
      expect(body).toContain("appGeneric");
    });

    it("falls back to the default locale for an unsupported one", async () => {
      const body = await html({ entity: "app", locale: "zz-ZZ" });
      expect(body).toContain('lang="en-US"');
    });

    it("ignores a non-numeric id instead of querying with NaN", async () => {
      process.env.LINK_PREVIEW_MODE = "names";
      await html({ entity: "test-run", id: "abc", locale: "en-US" });
      expect(mockLoadEntityPreview).not.toHaveBeenCalled();
    });

    it("responds as cacheable HTML", async () => {
      const response = await GET(
        createRequest({ entity: "app", locale: "en-US" })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=utf-8"
      );
      expect(response.headers.get("Cache-Control")).toContain("max-age=300");
    });
  });
});
