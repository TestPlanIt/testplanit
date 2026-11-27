import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MantisBTAdapter } from "./MantisBTAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const BASE_URL = "https://mantis.example.com";
const API = `${BASE_URL}/api/rest`;

function okJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function noContent() {
  return { ok: true, status: 204 };
}

function httpError(status: number, body = "error") {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

/** MantisBT answers a file upload with 201 and no body. */
function createdEmpty() {
  return {
    ok: true,
    status: 201,
    json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
  };
}

const TIPTAP_DOC = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Iteration 3 of 5 on " },
        { type: "text", text: "Bad password", marks: [{ type: "bold" }] },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "first" }] },
          ],
        },
      ],
    },
  ],
};

const TIPTAP_MARKDOWN = "Iteration 3 of 5 on **Bad password**\n\n- first";

/** `count` issues for a scan page, none of them in a version. */
function plainIssues(startId: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: startId + i }));
}

describe("MantisBTAdapter", () => {
  let adapter: MantisBTAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    adapter = new MantisBTAdapter({ provider: "MANTISBT", baseUrl: BASE_URL });
    // Strip the inter-request throttle/backoff so multi-request methods don't sleep.
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).maxRetries = 0;
  });

  /** Authenticate the adapter, consuming one mocked /users/me call. */
  async function authenticate() {
    mockFetch.mockResolvedValueOnce(okJson({ id: 1, name: "admin" }));
    await adapter.authenticate({ type: "api_key", apiKey: "test-key" });
    mockFetch.mockClear();
  }

  describe("getCapabilities", () => {
    it("reports the supported capabilities", () => {
      expect(adapter.getCapabilities()).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: true,
        attachments: true,
        linkedIssues: true,
        comments: true,
        milestones: { kinds: ["RELEASE"], webhooks: false },
      });
    });
  });

  describe("authenticate", () => {
    it("validates the token against /users/me and sends the raw Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ id: 1 }));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "abc123" })
      ).resolves.not.toThrow();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/users/me`);
      // Raw token, no "Bearer"/"token" prefix.
      expect(opts.headers["Authorization"]).toBe("abc123");
    });

    it("accepts the token supplied as apiToken", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ id: 1 }));

      await adapter.authenticate({ type: "api_key", apiToken: "tok-456" });

      expect(mockFetch.mock.calls[0][1].headers["Authorization"]).toBe(
        "tok-456"
      );
    });

    it("uses baseUrl from authData when not configured", async () => {
      const noUrlAdapter = new MantisBTAdapter({ provider: "MANTISBT" });
      (noUrlAdapter as any).maxRetries = 0;
      mockFetch.mockResolvedValueOnce(okJson({ id: 1 }));

      await noUrlAdapter.authenticate({
        type: "api_key",
        apiKey: "k",
        baseUrl: "https://mantis.internal/",
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://mantis.internal/api/rest/users/me"
      );
    });

    it("throws a friendly error on a rejected token", async () => {
      mockFetch.mockResolvedValueOnce(httpError(401, "Unauthorized"));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "bad" })
      ).rejects.toThrow("Invalid MantisBT API token or instance URL");
    });

    it("rejects non-api_key auth types", async () => {
      await expect(
        adapter.authenticate({ type: "oauth", accessToken: "x" })
      ).rejects.toThrow("only supports API token authentication");
    });

    it("requires an API token", async () => {
      await expect(adapter.authenticate({ type: "api_key" })).rejects.toThrow(
        "MantisBT API token is required"
      );
    });
  });

  describe("getIssue", () => {
    it("unwraps the single-element issues array and maps the fields", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 42,
              summary: "Login fails",
              description: "Steps to reproduce",
              status: { id: 50, name: "assigned" },
              priority: { id: 30, name: "high" },
              category: { id: 9, name: "Authentication" },
              handler: { id: 7, name: "dev1", real_name: "Dev One" },
              reporter: { id: 3, name: "qa", real_name: "QA Person" },
              tags: [{ id: 1, name: "regression" }],
              custom_fields: [
                { field: { id: 11, name: "Severity" }, value: "Critical" },
              ],
              created_at: "2024-01-15T10:00:00Z",
              updated_at: "2024-01-16T12:00:00Z",
            },
          ],
        })
      );

      const issue = await adapter.getIssue("#42");

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/issues/42`);
      expect(issue).toMatchObject({
        id: "42",
        key: "#42",
        title: "Login fails",
        status: "assigned",
        priority: "high",
        issueType: { id: "9", name: "Authentication" },
        assignee: { id: "7", name: "Dev One" },
        reporter: { id: "3", name: "QA Person" },
        labels: ["regression"],
        customFields: { Severity: "Critical" },
        url: `${BASE_URL}/view.php?id=42`,
      });
      expect(issue.createdAt).toBeInstanceOf(Date);
    });

    it("throws when the issue is not present in the response", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [] }));

      await expect(adapter.getIssue("99")).rejects.toThrow("not found");
    });
  });

  describe("searchIssues", () => {
    it("fetches directly by id for a numeric query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issues: [{ id: 7, summary: "Found" }] })
      );

      const res = await adapter.searchIssues({ query: "7" });

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/issues/7`);
      expect(res).toMatchObject({ total: 1, hasMore: false });
      expect(res.issues[0].key).toBe("#7");
    });

    it("returns empty when a direct id lookup 404s", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(404, "Not Found"));

      const res = await adapter.searchIssues({ query: "#999" });

      expect(res).toEqual({ issues: [], total: 0, hasMore: false });
    });

    it("returns empty for a text query with no project scope (no REST text search)", async () => {
      await authenticate();

      const res = await adapter.searchIssues({ query: "login" });

      expect(res).toEqual({ issues: [], total: 0, hasMore: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("lists a project page and filters by summary substring for a text query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            { id: 1, summary: "login bug" },
            { id: 2, summary: "logout works" },
          ],
        })
      );

      const res = await adapter.searchIssues({
        query: "login",
        projectId: "3",
        limit: 10,
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe("/api/rest/issues");
      expect(url.searchParams.get("project_id")).toBe("3");
      expect(url.searchParams.get("page_size")).toBe("100");
      expect(res.issues).toHaveLength(1);
      expect(res.issues[0].id).toBe("1");
    });

    it("reports hasMore when the tracker returned a full page", async () => {
      await authenticate();
      const fullPage = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        summary: `issue ${i + 1}`,
      }));
      mockFetch.mockResolvedValueOnce(okJson({ issues: fullPage }));

      const res = await adapter.searchIssues({ projectId: "3", limit: 5 });

      expect(res.issues).toHaveLength(5);
      expect(res.hasMore).toBe(true);
    });

    it("reports hasMore from the raw page even when the text filter empties it", async () => {
      await authenticate();
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        summary: "unrelated issue",
      }));
      mockFetch.mockResolvedValueOnce(okJson({ issues: fullPage }));

      const res = await adapter.searchIssues({
        query: "login",
        projectId: "3",
        limit: 10,
      });

      expect(res.issues).toEqual([]);
      expect(res.hasMore).toBe(true);
    });

    it("ignores issueTypeIds entirely — the request URL and returned issues are unchanged", async () => {
      await authenticate();
      const page = [
        { id: 1, summary: "login bug" },
        { id: 2, summary: "logout works" },
      ];
      // Issues without dates are stamped `new Date()` on mapping; the two
      // calls below must see the same clock or a millisecond boundary
      // between them fails the deep-equal under full-suite load.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      try {
        mockFetch.mockResolvedValueOnce(okJson({ issues: page }));

        const withoutTypes = await adapter.searchIssues({
          projectId: "3",
          limit: 10,
        });
        const urlWithoutTypes = mockFetch.mock.calls[0][0];

        mockFetch.mockClear();
        mockFetch.mockResolvedValueOnce(okJson({ issues: page }));

        const withTypes = await adapter.searchIssues({
          projectId: "3",
          limit: 10,
          issueTypeIds: ["10", "20"],
        });
        const urlWithTypes = mockFetch.mock.calls[0][0];

        expect(urlWithTypes).toBe(urlWithoutTypes);
        expect(withTypes.issues).toEqual(withoutTypes.issues);
        expect(withTypes.total).toBe(withoutTypes.total);
        expect(withTypes.hasMore).toBe(withoutTypes.hasMore);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("createIssue", () => {
    it("POSTs an issue with summary, project, category, priority and handler", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 100, summary: "New bug" } })
      );

      const result = await adapter.createIssue({
        title: "New bug",
        description: "details",
        projectId: "5",
        issueType: "9", // category id
        priority: "high",
        assigneeId: "8",
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/issues`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        summary: "New bug",
        description: "details",
        project: { id: 5 },
        category: { id: 9 },
        priority: { name: "high" },
        handler: { id: 8 },
      });
      expect(result.id).toBe("100");
    });

    it("sends a category name when the type value is non-numeric", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 101 } }));

      await adapter.createIssue({
        title: "x",
        projectId: "5",
        issueType: "Authentication",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.category).toEqual({ name: "Authentication" });
      expect(body.description).toBe(""); // Mantis requires a description
    });

    const projectWithFields = {
      projects: [
        {
          id: 5,
          name: "Web",
          custom_fields: [
            { id: 1, name: "Build", type: "string" },
            { id: 2, name: "Browsers", type: "multilist" },
            { id: 3, name: "Found on", type: "date" },
            { id: 4, name: "Retries", type: "numeric" },
          ],
        },
      ],
    };

    it("sends custom field values in the formats Mantis takes", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson(projectWithFields));
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 102 } }));

      await adapter.createIssue({
        title: "x",
        projectId: "5",
        customFields: {
          "1": "2026.11",
          "2": ["Firefox", "Safari"],
          "3": "2026-11-23",
          "4": 3,
        },
      });

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/projects/5`);
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.custom_fields).toEqual([
        { field: { id: 1, name: "Build" }, value: "2026.11" },
        { field: { id: 2, name: "Browsers" }, value: "Firefox|Safari" },
        {
          field: { id: 3, name: "Found on" },
          value: String(Date.UTC(2026, 10, 23, 12) / 1000),
        },
        { field: { id: 4, name: "Retries" }, value: "3" },
      ]);
    });

    it("leaves out empty values and keys that are not fields of the project", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson(projectWithFields));
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 103 } }));

      await adapter.createIssue({
        title: "x",
        projectId: "5",
        customFields: {
          "1": "",
          "2": [],
          "3": "not a date",
          "4": 0,
          "99": "unknown field",
          reporter: { accountId: "8" },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.custom_fields).toEqual([
        { field: { id: 4, name: "Retries" }, value: "0" },
      ]);
    });

    it("does not read the project when no custom field has a value", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 104 } }));

      await adapter.createIssue({
        title: "x",
        projectId: "5",
        customFields: { "1": "", reporter: { accountId: "8" } },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_fields).toBeUndefined();
    });
  });

  describe("getIssueTypeFields", () => {
    const field = (overrides: Record<string, unknown>) => ({
      type: "string",
      default_value: "",
      possible_values: "",
      display_report: true,
      require_report: false,
      ...overrides,
    });

    async function fieldsFor(
      customFields: unknown[],
      project: Record<string, unknown> = {}
    ) {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          projects: [
            { id: 5, name: "Web", ...project, custom_fields: customFields },
          ],
        })
      );
      return adapter.getIssueTypeFields("5", "9");
    }

    it("lists the fields Mantis shows or requires when reporting", async () => {
      const fields = await fieldsFor([
        field({ id: 1, name: "Shown" }),
        field({ id: 2, name: "Hidden", display_report: false }),
        field({
          id: 3,
          name: "Required",
          display_report: false,
          require_report: true,
        }),
      ]);

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/projects/5`);
      expect(fields.map((f) => [f.key, f.name, f.required])).toEqual([
        ["1", "Shown", false],
        ["3", "Required", true],
      ]);
    });

    it("maps each Mantis field type to a form input", async () => {
      const fields = await fieldsFor([
        field({ id: 1, name: "Text", default_value: "n/a" }),
        field({ id: 2, name: "Email", type: "email" }),
        field({ id: 3, name: "Long", type: "textarea" }),
        field({ id: 4, name: "Whole", type: "numeric", default_value: "2" }),
        field({ id: 5, name: "Decimal", type: "float" }),
        field({ id: 6, name: "Date", type: "date", default_value: "{today}" }),
        field({
          id: 7,
          name: "Enum",
          type: "enum",
          possible_values: "|low|high",
          default_value: "low",
        }),
        field({ id: 8, name: "List", type: "list", possible_values: "a|b" }),
        field({ id: 9, name: "Radio", type: 9, possible_values: "yes|no" }),
        field({
          id: 10,
          name: "Checkbox",
          type: "checkbox",
          possible_values: "x|y|z",
          default_value: "x|z",
        }),
        field({
          id: 11,
          name: "Multi",
          type: "multilist",
          possible_values: "p|q",
        }),
      ]);
      const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
      const options = (...values: string[]) =>
        values.map((v) => ({ id: v, name: v }));

      expect(byName.Text).toMatchObject({
        schema: { type: "string" },
        defaultValue: "n/a",
      });
      expect(byName.Text.input).toBeUndefined();
      expect(byName.Email.schema).toEqual({ type: "string" });
      expect(byName.Long).toMatchObject({
        schema: { type: "string" },
        input: "textarea",
      });
      expect(byName.Whole).toMatchObject({
        schema: { type: "number" },
        defaultValue: 2,
      });
      expect(byName.Decimal.schema).toEqual({ type: "number" });
      expect(byName.Date).toMatchObject({ input: "date" });
      expect(byName.Date.defaultValue).toBeUndefined();
      expect(byName.Enum).toMatchObject({
        allowedValues: options("low", "high"),
        defaultValue: "low",
      });
      expect(byName.List.allowedValues).toEqual(options("a", "b"));
      expect(byName.Radio.allowedValues).toEqual(options("yes", "no"));
      expect(byName.Checkbox).toMatchObject({
        input: "multiselect",
        allowedValues: options("x", "y", "z"),
        defaultValue: ["x", "z"],
      });
      expect(byName.Multi).toMatchObject({
        input: "multiselect",
        allowedValues: options("p", "q"),
      });
    });

    it("lists the project's versions and categories for the lists Mantis computes", async () => {
      const fields = await fieldsFor(
        [
          field({
            id: 1,
            name: "All",
            type: "list",
            possible_values: "=versions",
          }),
          field({
            id: 2,
            name: "Released",
            type: "multilist",
            possible_values: "=released_versions",
          }),
          field({
            id: 3,
            name: "Future",
            type: "enum",
            possible_values: "=future_versions",
          }),
          field({
            id: 4,
            name: "Area",
            type: "enum",
            possible_values: "=categories",
          }),
        ],
        {
          versions: [
            { id: 2, name: "2.0", released: false, obsolete: false },
            { id: 1, name: "1.0", released: true, obsolete: false },
            { id: 3, name: "0.1", released: true, obsolete: true },
          ],
          categories: [
            { id: 1, name: "General" },
            { id: 2, name: "UI" },
          ],
        }
      );
      const byName = Object.fromEntries(fields.map((f: any) => [f.name, f]));
      const options = (...values: string[]) =>
        values.map((v) => ({ id: v, name: v }));

      expect(byName.All.allowedValues).toEqual(options("2.0", "1.0"));
      expect(byName.Released).toMatchObject({
        input: "multiselect",
        allowedValues: options("1.0"),
      });
      expect(byName.Future.allowedValues).toEqual(options("2.0"));
      expect(byName.Area.allowedValues).toEqual(options("General", "UI"));
    });

    it("offers a text input for a computed list with nothing to list", async () => {
      const fields = await fieldsFor([
        field({
          id: 1,
          name: "Sprint",
          type: "enum",
          possible_values: "=sprints",
        }),
        field({
          id: 2,
          name: "Fixed in",
          type: "enum",
          possible_values: "=versions",
        }),
      ]);

      for (const fieldDef of fields) {
        expect(fieldDef.schema).toEqual({ type: "string" });
        expect(fieldDef.allowedValues).toBeUndefined();
      }
    });

    it("returns no fields when the project cannot be read", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(404, "Not Found"));

      expect(await adapter.getIssueTypeFields("5", "9")).toEqual([]);
    });
  });

  describe("updateIssue", () => {
    it("PATCHes changed fields by name then re-fetches the issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(noContent()); // PATCH
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            { id: 42, summary: "Updated", status: { name: "resolved" } },
          ],
        })
      ); // GET

      const result = await adapter.updateIssue("#42", {
        title: "Updated",
        status: "resolved",
      });

      const [patchUrl, patchOpts] = mockFetch.mock.calls[0];
      expect(patchUrl).toBe(`${API}/issues/42`);
      expect(patchOpts.method).toBe("PATCH");
      expect(JSON.parse(patchOpts.body)).toEqual({
        summary: "Updated",
        status: { name: "resolved" },
      });
      expect(result.title).toBe("Updated");
      expect(mockFetch.mock.calls[1][0]).toBe(`${API}/issues/42`);
    });
  });

  describe("getIssueComments", () => {
    it("returns notes, skipping empty entries", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 5,
              notes: [
                {
                  id: 1,
                  text: "first note",
                  reporter: { id: 2, real_name: "Bob" },
                  created_at: "2024-01-01",
                },
                { id: 2, text: "  ", reporter: { id: 3, name: "Quiet" } },
              ],
            },
          ],
        })
      );

      const comments = await adapter.getIssueComments("5");

      expect(comments).toEqual([
        { id: "1", author: "Bob", body: "first note", created: "2024-01-01" },
      ]);
    });

    it("fails soft to an empty array on error", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(500, "boom"));

      await expect(adapter.getIssueComments("5")).resolves.toEqual([]);
    });
  });

  describe("getLinkedIssues", () => {
    it("maps relationships to the related issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 10,
              relationships: [
                {
                  id: 1,
                  type: { id: 2, name: "related to" },
                  issue: { id: 20 },
                },
                {
                  id: 2,
                  type: { id: 4, name: "duplicate of" },
                  issue: { id: 5 },
                },
              ],
            },
          ],
        })
      );

      const links = await adapter.getLinkedIssues("10");

      expect(links).toEqual([
        { id: "20", key: "#20", linkType: "related to", direction: "outward" },
        { id: "5", key: "#5", linkType: "duplicate of", direction: "outward" },
      ]);
    });
  });

  describe("metadata lookups", () => {
    it("getProjects maps id/name with the id as the key", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ projects: [{ id: 1, name: "Website" }] })
      );

      expect(await adapter.getProjects()).toEqual([
        { id: "1", key: "1", name: "Website" },
      ]);
    });

    it("getIssueTypes returns the project's categories", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          projects: [
            {
              id: 3,
              name: "Website",
              categories: [
                { id: 9, name: "Authentication" },
                { id: 10, name: "UI" },
              ],
            },
          ],
        })
      );

      expect(await adapter.getIssueTypes("3")).toEqual([
        { id: "9", name: "Authentication" },
        { id: "10", name: "UI" },
      ]);
      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/projects/3`);
    });
  });

  describe("getCurrentUser", () => {
    it("returns the authenticated user from /users/me", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          id: 1,
          name: "ada",
          real_name: "Ada Lovelace",
          email: "ada@x.io",
        })
      );

      expect(await adapter.getCurrentUser()).toEqual({
        accountId: "1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@x.io",
      });
    });
  });

  describe("TipTap descriptions", () => {
    it("createIssue sends a TipTap doc as Markdown", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 102 } }));

      await adapter.createIssue({
        title: "From an iteration",
        description: TIPTAP_DOC,
        projectId: "5",
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).description).toBe(
        TIPTAP_MARKDOWN
      );
    });

    it("updateIssue sends a TipTap doc as Markdown", async () => {
      await authenticate();
      mockFetch
        .mockResolvedValueOnce(okJson({ issues: [{ id: 42 }] }))
        .mockResolvedValueOnce(okJson({ issues: [{ id: 42 }] }));

      await adapter.updateIssue("42", { description: TIPTAP_DOC });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        description: TIPTAP_MARKDOWN,
      });
    });

    it("passes a string description through unchanged", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 103 } }));

      await adapter.createIssue({
        title: "Plain",
        description: "a_b * c",
        projectId: "5",
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).description).toBe(
        "a_b * c"
      );
    });
  });

  describe("uploadAttachment", () => {
    it("POSTs the file as base64 and accepts the empty 201 answer", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(createdEmpty());

      const result = await adapter.uploadAttachment(
        "#42",
        Buffer.from("hello"),
        "shot.png"
      );

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/issues/42/files`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        files: [{ name: "shot.png", content: "aGVsbG8=" }],
      });
      expect(result).toEqual({ id: "", url: "" });
    });

    it("throws when MantisBT refuses the file", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(400, "File too big"));

      await expect(
        adapter.uploadAttachment("42", Buffer.from("x"), "big.mp4")
      ).rejects.toThrow("HTTP 400: File too big");
    });
  });

  describe("listAttachments", () => {
    it("reads metadata from the issue, including files added with a note", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 42,
              attachments: [
                {
                  id: 3,
                  filename: "spec.pdf",
                  size: 125,
                  content_type: "application/pdf; charset=us-ascii",
                  created_at: "2026-11-27T14:26:52+00:00",
                },
                {
                  id: 2,
                  filename: "shot.png",
                  size: 70,
                  content_type: "image/png; charset=binary",
                },
              ],
              notes: [
                { id: 1, text: "no files" },
                {
                  id: 2,
                  text: "see screenshot",
                  attachments: [
                    {
                      id: 4,
                      filename: "note-shot.png",
                      size: 78,
                      content_type: "image/png; charset=binary",
                    },
                    { id: 2, filename: "shot.png" },
                  ],
                },
              ],
            },
          ],
        })
      );

      const result = await adapter.listAttachments("#42");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${API}/issues/42?select=id,attachments,notes`
      );
      expect(result).toEqual([
        {
          id: "2",
          filename: "shot.png",
          mimeType: "image/png",
          byteSize: 70,
          createdAt: undefined,
          contentUrl: `${API}/issues/42/files/2`,
        },
        {
          id: "3",
          filename: "spec.pdf",
          mimeType: "application/pdf",
          byteSize: 125,
          createdAt: new Date("2026-11-27T14:26:52+00:00"),
          contentUrl: `${API}/issues/42/files/3`,
        },
        {
          id: "4",
          filename: "note-shot.png",
          mimeType: "image/png",
          byteSize: 78,
          createdAt: undefined,
          contentUrl: `${API}/issues/42/files/4`,
        },
      ]);
    });

    it("returns nothing for an issue without files", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [{ id: 42 }] }));

      await expect(adapter.listAttachments("42")).resolves.toEqual([]);
    });
  });

  describe("downloadAttachment", () => {
    const meta = {
      id: "2",
      filename: "shot.png",
      mimeType: "image/png",
      byteSize: 5,
      contentUrl: `${API}/issues/42/files/2`,
    };

    it("decodes the base64 content of the file", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          files: [
            {
              id: 2,
              filename: "shot.png",
              size: 5,
              content_type: "image/png; charset=binary",
              content: "aGVsbG8=",
            },
          ],
        })
      );

      const result = await adapter.downloadAttachment(meta);

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/issues/42/files/2`);
      expect(result.buffer.toString("utf8")).toBe("hello");
      expect(result.mimeType).toBe("image/png");
    });

    it("keeps the listed type when MantisBT reports a generic one", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          files: [
            {
              id: 2,
              content_type: "application/octet-stream; charset=binary",
              content: "aGVsbG8=",
            },
          ],
        })
      );

      const result = await adapter.downloadAttachment(meta);

      expect(result.mimeType).toBe("image/png");
    });

    it("refuses a URL outside this instance's issue files", async () => {
      await authenticate();

      await expect(
        adapter.downloadAttachment({
          ...meta,
          contentUrl:
            "https://elsewhere.example.com/api/rest/issues/42/files/2",
        })
      ).rejects.toThrow("MantisBT attachment has no download URL");
      await expect(
        adapter.downloadAttachment({ ...meta, contentUrl: undefined })
      ).rejects.toThrow("MantisBT attachment has no download URL");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not fetch a file listed as over the size cap", async () => {
      await authenticate();

      await expect(
        adapter.downloadAttachment({ ...meta, byteSize: 11 * 1024 * 1024 })
      ).rejects.toThrow("Binary response too large");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects content that decodes past the size cap", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          files: [
            {
              id: 2,
              content: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
            },
          ],
        })
      );

      await expect(
        adapter.downloadAttachment({ ...meta, byteSize: undefined })
      ).rejects.toThrow("Binary response too large");
    });

    it("throws when the file is gone", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ files: [] }));

      await expect(adapter.downloadAttachment(meta)).rejects.toThrow(
        "MantisBT attachment 2 has no content"
      );
    });
  });

  describe("getExternalMilestones", () => {
    const project = {
      id: 5,
      name: "Demo",
      versions: [
        {
          id: 4,
          name: "9.0",
          description: "Next",
          released: false,
          obsolete: false,
          timestamp: "2027-03-01T00:00:00+00:00",
        },
        {
          id: 5,
          name: "8.0",
          description: "",
          released: true,
          obsolete: false,
          timestamp: "2026-09-15T00:00:00+00:00",
        },
        { id: 6, name: "7.0", released: true, obsolete: true },
        { id: 7, name: "6.0-dropped", released: false, obsolete: true },
        { name: "no id" },
      ],
    };

    it("maps the project's versions to RELEASE milestones", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ projects: [project] }));

      const result = await adapter.getExternalMilestones({
        projectKey: "5",
        includeClosed: true,
      });

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/projects/5`);
      expect(result).toEqual({
        hasMore: false,
        items: [
          {
            id: "5:4",
            kind: "RELEASE",
            name: "9.0",
            description: "Next",
            endDate: new Date("2027-03-01T00:00:00Z"),
            state: "ACTIVE",
            rawState: "unreleased",
            url: `${BASE_URL}/roadmap_page.php?version_id=4`,
          },
          {
            id: "5:5",
            kind: "RELEASE",
            name: "8.0",
            description: undefined,
            endDate: new Date("2026-09-15T00:00:00Z"),
            state: "CLOSED",
            rawState: "released",
            url: `${BASE_URL}/changelog_page.php?version_id=5`,
          },
          {
            id: "5:6",
            kind: "RELEASE",
            name: "7.0",
            description: undefined,
            endDate: undefined,
            state: "CLOSED",
            rawState: "obsolete",
            url: `${BASE_URL}/changelog_page.php?version_id=6`,
          },
          {
            id: "5:7",
            kind: "RELEASE",
            name: "6.0-dropped",
            description: undefined,
            endDate: undefined,
            state: "CLOSED",
            rawState: "obsolete",
            url: `${BASE_URL}/roadmap_page.php?version_id=7`,
          },
        ],
      });
    });

    it("leaves released and obsolete versions out unless closed ones are asked for", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ projects: [project] }));

      const result = await adapter.getExternalMilestones({ projectKey: "5" });

      expect(result.items.map((item) => item.id)).toEqual(["5:4"]);
    });

    it("has no ITERATION milestones and does not ask MantisBT for them", async () => {
      await authenticate();

      await expect(
        adapter.getExternalMilestones({ projectKey: "5", kind: "ITERATION" })
      ).resolves.toEqual({ items: [], hasMore: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws when the project is not returned", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ projects: [] }));

      await expect(
        adapter.getExternalMilestones({ projectKey: "5" })
      ).rejects.toThrow("MantisBT project 5 not found");
    });
  });

  describe("getMilestoneIssues", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const page = [
      { id: 10, summary: "targeted", target_version: { id: 4, name: "9.0" } },
      {
        id: 11,
        summary: "both",
        target_version: { id: 4, name: "9.0" },
        fixed_in_version: { id: 5, name: "8.0" },
      },
      {
        id: 12,
        summary: "fixed",
        status: { id: 90, name: "closed" },
        fixed_in_version: { id: 5, name: "8.0" },
      },
      {
        id: 13,
        summary: "same version twice",
        target_version: { id: 6, name: "7.0" },
        fixed_in_version: { id: 6, name: "7.0" },
      },
      { id: 14, summary: "no version" },
    ];

    it("returns the issues targeted at or fixed in the version, from one project walk", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: page }));

      const nine = await adapter.getMilestoneIssues(
        { id: "5:4", kind: "RELEASE" },
        { limit: 100 }
      );
      const eight = await adapter.getMilestoneIssues({
        id: "5:5",
        kind: "RELEASE",
      });
      const seven = await adapter.getMilestoneIssues({
        id: "5:6",
        kind: "RELEASE",
      });
      const none = await adapter.getMilestoneIssues({
        id: "5:99",
        kind: "RELEASE",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(`${url.origin}${url.pathname}`).toBe(`${API}/issues`);
      expect(url.searchParams.get("project_id")).toBe("5");
      expect(url.searchParams.get("page_size")).toBe("1000");
      expect(url.searchParams.get("page")).toBe("1");
      expect(url.searchParams.get("select")?.split(",")).toEqual(
        expect.arrayContaining([
          "id",
          "summary",
          "description",
          "status",
          "target_version",
          "fixed_in_version",
        ])
      );

      expect(nine.issues.map((i) => i.id)).toEqual(["10", "11"]);
      expect(nine).toMatchObject({ total: 2, hasMore: false });
      expect(eight.issues.map((i) => i.id)).toEqual(["11", "12"]);
      expect(eight.issues[1]).toMatchObject({
        key: "#12",
        title: "fixed",
        status: "closed",
      });
      expect(seven.issues.map((i) => i.id)).toEqual(["13"]);
      expect(none).toEqual({ issues: [], total: 0, hasMore: false });
    });

    it("returns nothing, without a request, for a sprint or an id it did not issue", async () => {
      await authenticate();

      await expect(
        adapter.getMilestoneIssues({ id: "5:4", kind: "ITERATION" })
      ).resolves.toEqual({ issues: [], hasMore: false });
      await expect(
        adapter.getMilestoneIssues({ id: "owner/repo#4", kind: "RELEASE" })
      ).resolves.toEqual({ issues: [], hasMore: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("walks every page, then reads the first again for issues updated meanwhile", async () => {
      await authenticate();
      const moved = {
        id: 5000,
        summary: "retargeted during the walk",
        target_version: { id: 4, name: "9.0" },
      };
      const left = { id: 1, summary: "left the version during the walk" };
      mockFetch
        .mockResolvedValueOnce(
          okJson({
            issues: [
              { id: 1, target_version: { id: 4, name: "9.0" } },
              ...plainIssues(2, 999),
            ],
          })
        )
        .mockResolvedValueOnce(
          okJson({
            issues: [
              { id: 2001, fixed_in_version: { id: 4, name: "9.0" } },
              ...plainIssues(2002, 999),
            ],
          })
        )
        .mockResolvedValueOnce(okJson({ issues: plainIssues(4000, 3) }))
        .mockResolvedValueOnce(
          okJson({ issues: [moved, left, ...plainIssues(2, 998)] })
        );

      const result = await adapter.getMilestoneIssues({
        id: "5:4",
        kind: "RELEASE",
      });

      expect(
        mockFetch.mock.calls.map(([url]) =>
          new URL(url).searchParams.get("page")
        )
      ).toEqual(["1", "2", "3", "1"]);
      expect(result.issues.map((i) => i.id).sort()).toEqual(["2001", "5000"]);
    });

    it("refuses a project past the page limit and does not keep the failure", async () => {
      await authenticate();
      mockFetch.mockImplementation(() =>
        Promise.resolve(okJson({ issues: plainIssues(1, 1000) }))
      );

      await expect(
        adapter.getMilestoneIssues({ id: "5:4", kind: "RELEASE" })
      ).rejects.toThrow(
        "MantisBT project 5 has 20000 or more issues, too many to read in full."
      );
      expect(mockFetch).toHaveBeenCalledTimes(20);

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(okJson({ issues: page }));
      const retry = await adapter.getMilestoneIssues({
        id: "5:4",
        kind: "RELEASE",
      });
      expect(retry.issues.map((i) => i.id)).toEqual(["10", "11"]);
    });

    it("shares one walk between concurrent callers and walks again after a minute", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: page }));

      const [first, second] = await Promise.all([
        adapter.getMilestoneIssues({ id: "5:4", kind: "RELEASE" }),
        adapter.getMilestoneIssues({ id: "5:5", kind: "RELEASE" }),
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(first.issues).toHaveLength(2);
      expect(second.issues).toHaveLength(2);

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
      mockFetch.mockResolvedValueOnce(
        okJson({ issues: [{ id: 10, target_version: { id: 5, name: "8.0" } }] })
      );

      const later = await adapter.getMilestoneIssues({
        id: "5:4",
        kind: "RELEASE",
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(later.issues).toEqual([]);
    });

    it("walks each project separately", async () => {
      await authenticate();
      mockFetch
        .mockResolvedValueOnce(okJson({ issues: page }))
        .mockResolvedValueOnce(
          okJson({ issues: [{ id: 77, target_version: { id: 4 } }] })
        );

      await adapter.getMilestoneIssues({ id: "5:4", kind: "RELEASE" });
      const other = await adapter.getMilestoneIssues({
        id: "6:4",
        kind: "RELEASE",
      });

      expect(
        mockFetch.mock.calls.map(([url]) =>
          new URL(url).searchParams.get("project_id")
        )
      ).toEqual(["5", "6"]);
      expect(other.issues.map((i) => i.id)).toEqual(["77"]);
    });
  });

  describe("linkToTestCase", () => {
    it("adds a note via POST and swallows failures", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ note: { id: 1 } }));

      await adapter.linkToTestCase("#42", "TC-1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/issues/42/notes`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body).text).toContain("TC-1");
    });
  });
});
