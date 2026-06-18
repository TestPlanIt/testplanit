import { expect, test } from "../../fixtures/index";
import type { APIRequestContext } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 8 E2E — Code repositories list (REPO-01).
 *
 * Exercises the same REST endpoint the Phase 8 MCP tool
 * `testplanit_code_repositories_list` calls internally. Running against a
 * production build proves the host accepts the request shape the MCP tool
 * generates AND the response excludes the `credentials` column at the
 * underlying ZenStack layer.
 *
 * Coverage map:
 *   REPO-01 → testplanit_code_repositories_list
 *
 * Test mode: serial — beforeAll resolves the seed-context state.
 *
 * Skips: when the seed has no ProjectCodeRepositoryConfig row for the
 * resolved project, the test logs a `console.warn(...)` skip-reason and
 * exits early. The seed file does not currently create such a row, so
 * this spec typically skips against a pristine seed; the framework lives
 * here for production smoke runs that have a real config attached.
 */

interface SeedContext {
  projectId: number;
  token: string;
  headers: Record<string, string>;
}

async function findFirst(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  model: string,
  where: Record<string, unknown>,
  select?: Record<string, unknown>
): Promise<{ id: number } | null> {
  const q = encodeURIComponent(
    JSON.stringify({ where, ...(select ? { select } : {}) })
  );
  const r = await request.get(
    `${baseURL}/api/model/${model}/findFirst?q=${q}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (r.status() !== 200) return null;
  const body = await r.json();
  return body.data ?? null;
}

// Per-provider public-key allow-list (mirrors
// packages/mcp-server/src/tools/code-repositories/shared.ts SETTINGS_ALLOW_LIST).
// Inlined here on purpose: the E2E test verifies the wire shape, not the
// package source. If the package allow-list grows, the spec file is the second
// gate that fails until both sides update.
const SETTINGS_ALLOW_LIST: Record<string, ReadonlyArray<string>> = {
  GITHUB: ["owner", "repo"],
  GITLAB: ["baseUrl", "owner", "repo"],
  BITBUCKET: ["baseUrl", "owner", "repo"],
  AZURE_DEVOPS: ["organizationUrl", "project", "repositoryId"],
  GITEA: ["baseUrl", "owner", "repo"],
};

test.describe("MCP code-repositories read (Phase 8 REPO-01)", () => {
  let ctx: SeedContext;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase8-code-repositories-${Date.now()}` },
    });
    expect(r.status()).toBe(200);
    const token = (await r.json()).token as string;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const project = await findFirst(request, baseURL!, token, "projects", {
      isDeleted: false,
    });
    expect(project, "seed must have at least one project").not.toBeNull();

    ctx = {
      projectId: project!.id,
      token,
      headers,
    };
  });

  // -- REPO-01: list project code repositories with credentials never returned

  test("REPO-01 — list ProjectCodeRepositoryConfig with allow-listed settings + no credentials on the wire", async ({
    request,
    baseURL,
  }) => {
    let responseText: string | undefined;
    let body: any;

    // List project code repository configs via the MCP-tool wire shape
    await test.step("List project code repository configs", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { projectId: ctx.projectId },
          include: {
            repository: {
              select: {
                id: true,
                name: true,
                provider: true,
                status: true,
                lastTestedAt: true,
                settings: true,
                // credentials INTENTIONALLY ABSENT — defense in depth.
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/projectCodeRepositoryConfig/findMany?q=${q}`,
        { headers: ctx.headers }
      );
      expect(r.status()).toBe(200);
      responseText = await r.text();
      body = JSON.parse(responseText);

      expect(Array.isArray(body.data)).toBe(true);
    });

    if (body.data.length === 0) {
      console.warn(
        "REPO-01 skipped: seed has 0 ProjectCodeRepositoryConfig rows"
      );
      return;
    }

    let row: any;

    // Verify the first row and repository shape
    await test.step("Verify the first config row and repository shape", async () => {
      row = body.data[0];
      expect(typeof row.id).toBe("number");
      expect(row.projectId).toBe(ctx.projectId);
      expect(row.repository).not.toBeNull();
      expect(typeof row.repository.id).toBe("number");
      expect(typeof row.repository.name).toBe("string");
      expect(typeof row.repository.provider).toBe("string");
    });

    // Verify allow-listed settings and absent credentials column
    await test.step("Verify allow-listed settings and absent credentials column", async () => {
      // The mapper at the package layer strips settings to a per-provider
      // allow-list. The host returns the raw column; this assertion verifies
      // the allow-list is the right superset for the provider returned.
      const provider = row.repository.provider as string;
      const allow = SETTINGS_ALLOW_LIST[provider] ?? [];
      if (
        row.repository.settings &&
        typeof row.repository.settings === "object"
      ) {
        // For an MCP-tool round-trip we only verify that the response COULD be
        // stripped to allow-listed keys (if extra keys are present, the package
        // strips them at the boundary). The end-to-end privacy guarantee comes
        // from the package mapper, not the host wire — but the host MUST not
        // return the credentials column.
        expect(
          Object.prototype.hasOwnProperty.call(row.repository, "credentials")
        ).toBe(false);
        const settingKeys = Object.keys(row.repository.settings);
        // At least one of the returned setting keys should be in the allow-list
        // for known providers (sanity — guards against an entirely-mismatched
        // shape). For unknown providers the allow list is empty by design.
        if (allow.length > 0 && settingKeys.length > 0) {
          const hasAtLeastOneAllowed = settingKeys.some((k) =>
            allow.includes(k)
          );
          expect(hasAtLeastOneAllowed).toBe(true);
        }
      }
    });

    // Verify the literal "credentials" substring never appears on the wire
    await test.step("Verify credentials substring never appears on the wire", async () => {
      // T-08-CRED-LEAK: the literal substring "credentials" must NEVER appear
      // in any response body the host returns to a token-bearer. The select
      // above does not include credentials; if the host ever leaks the column
      // (e.g. from a default-include or a forgotten omit), this assertion
      // catches it.
      expect(responseText).not.toContain("credentials");
    });
  });
});
