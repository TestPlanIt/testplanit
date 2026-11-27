import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedmineAdapter } from "./RedmineAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const BASE_URL = "https://redmine.example.com";

function okJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function noContent() {
  return { ok: true, status: 204 };
}

function httpError(status: number, body = "error") {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

function binary(bytes: number[], contentType: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": contentType,
      "content-length": String(bytes.length),
    }),
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
  };
}

const TIPTAP_DOC = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Iteration 2 failed for " },
        { type: "text", text: "Checkout", marks: [{ type: "bold" }] },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "browser: Firefox" }],
            },
          ],
        },
      ],
    },
  ],
};
const TIPTAP_DOC_MARKDOWN =
  "Iteration 2 failed for **Checkout**\n\n- browser: Firefox";

describe("RedmineAdapter", () => {
  let adapter: RedmineAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    adapter = new RedmineAdapter({ provider: "REDMINE", baseUrl: BASE_URL });
    // Strip the inter-request throttle/backoff so multi-request methods don't sleep.
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).maxRetries = 0;
  });

  /** Authenticate the adapter, consuming one mocked /users/current.json call. */
  async function authenticate() {
    mockFetch.mockResolvedValueOnce(
      okJson({ user: { id: 1, login: "admin" } })
    );
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
        milestones: { kinds: ["RELEASE"], webhooks: true },
      });
    });
  });

  describe("authenticate", () => {
    it("validates the key against /users/current.json and sends X-Redmine-API-Key", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ user: { id: 1 } }));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "abc123" })
      ).resolves.not.toThrow();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/users/current.json`);
      expect(opts.headers["X-Redmine-API-Key"]).toBe("abc123");
    });

    it("accepts the key supplied as apiToken", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ user: { id: 1 } }));

      await adapter.authenticate({ type: "api_key", apiToken: "tok-456" });

      expect(mockFetch.mock.calls[0][1].headers["X-Redmine-API-Key"]).toBe(
        "tok-456"
      );
    });

    it("uses baseUrl from authData when not configured", async () => {
      const noUrlAdapter = new RedmineAdapter({ provider: "REDMINE" });
      (noUrlAdapter as any).maxRetries = 0;
      mockFetch.mockResolvedValueOnce(okJson({ user: { id: 1 } }));

      await noUrlAdapter.authenticate({
        type: "api_key",
        apiKey: "k",
        baseUrl: "https://rm.internal/",
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://rm.internal/users/current.json"
      );
    });

    it("throws a friendly error on a rejected key", async () => {
      mockFetch.mockResolvedValueOnce(httpError(401, "Unauthorized"));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "bad" })
      ).rejects.toThrow("Invalid Redmine API key or instance URL");
    });

    it("rejects non-api_key auth types", async () => {
      await expect(
        adapter.authenticate({ type: "oauth", accessToken: "x" })
      ).rejects.toThrow("only supports API key authentication");
    });

    it("requires an API key", async () => {
      await expect(adapter.authenticate({ type: "api_key" })).rejects.toThrow(
        "Redmine API key is required"
      );
    });
  });

  describe("getIssue", () => {
    it("fetches an issue with journals + relations and maps the fields", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 42,
            subject: "Login fails",
            description: "Steps to reproduce",
            status: { id: 2, name: "In Progress" },
            priority: { id: 4, name: "High" },
            tracker: { id: 1, name: "Bug" },
            category: { id: 9, name: "Auth" },
            assigned_to: { id: 7, name: "Dev One" },
            author: { id: 3, name: "Reporter" },
            custom_fields: [{ id: 11, name: "Severity", value: "Critical" }],
            created_on: "2024-01-15T10:00:00Z",
            updated_on: "2024-01-16T12:00:00Z",
          },
        })
      );

      const issue = await adapter.getIssue("#42");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${BASE_URL}/issues/42.json?include=journals,relations`
      );
      expect(issue).toMatchObject({
        id: "42",
        key: "#42",
        title: "Login fails",
        status: "In Progress",
        priority: "High",
        issueType: { id: "1", name: "Bug" },
        assignee: { id: "7", name: "Dev One" },
        reporter: { id: "3", name: "Reporter" },
        labels: ["Auth"],
        customFields: { Severity: "Critical" },
        url: `${BASE_URL}/issues/42`,
      });
      expect(issue.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("searchIssues", () => {
    it("fetches directly by id for a numeric query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 7, subject: "Found" } })
      );

      const res = await adapter.searchIssues({ query: "7" });

      expect(mockFetch.mock.calls[0][0]).toContain("/issues/7.json");
      expect(res).toMatchObject({ total: 1, hasMore: false });
      expect(res.issues[0].key).toBe("#7");
    });

    it("returns empty when a direct id lookup 404s", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(404, "Not Found"));

      const res = await adapter.searchIssues({ query: "#999" });

      expect(res).toEqual({ issues: [], total: 0, hasMore: false });
    });

    it("uses a subject contains filter for a text query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [{ id: 1, subject: "login bug" }],
          total_count: 1,
        })
      );

      const res = await adapter.searchIssues({
        query: "login",
        projectId: "3",
        limit: 10,
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe("/issues.json");
      expect(url.searchParams.get("subject")).toBe("~login");
      expect(url.searchParams.get("project_id")).toBe("3");
      expect(url.searchParams.get("status_id")).toBe("*");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(res.total).toBe(1);
      expect(res.issues[0].id).toBe("1");
    });

    it("computes hasMore from total_count and offset", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [{ id: 1 }, { id: 2 }],
          total_count: 10,
        })
      );

      const res = await adapter.searchIssues({ limit: 2, offset: 0 });

      expect(res.hasMore).toBe(true);
      expect(res.total).toBe(10);
    });

    it("sets tracker_id as a pipe-delimited param for multiple selected types", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [], total_count: 0 }));

      await adapter.searchIssues({ issueTypeIds: ["2", "3"] });

      const url = new URL(mockFetch.mock.calls[0][0]);
      // URLSearchParams encodes the pipe rather than us hand-escaping it —
      // .get() decodes it back, proving the round trip.
      expect(url.searchParams.get("tracker_id")).toBe("2|3");
    });

    it("sets tracker_id to a single value when one type is selected", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [], total_count: 0 }));

      await adapter.searchIssues({ issueTypeIds: ["2"] });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get("tracker_id")).toBe("2");
    });

    it("produces today's exact query when issueTypeIds is absent or empty", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [], total_count: 0 }));
      await adapter.searchIssues({});
      const urlAbsent = new URL(mockFetch.mock.calls[0][0]);
      expect(urlAbsent.searchParams.has("tracker_id")).toBe(false);

      mockFetch.mockResolvedValueOnce(okJson({ issues: [], total_count: 0 }));
      await adapter.searchIssues({ issueTypeIds: [] });
      const urlEmpty = new URL(mockFetch.mock.calls[1][0]);
      expect(urlEmpty.searchParams.has("tracker_id")).toBe(false);
    });
  });

  describe("createIssue", () => {
    it("POSTs an issue with mapped fields", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 100, subject: "New bug" } })
      );

      const result = await adapter.createIssue({
        title: "New bug",
        description: "details",
        projectId: "5",
        issueType: "2",
        priority: "4",
        assigneeId: "8",
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/issues.json`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        issue: {
          project_id: "5",
          subject: "New bug",
          description: "details",
          tracker_id: 2,
          priority_id: 4,
          assigned_to_id: 8,
        },
      });
      expect(result.id).toBe("100");
    });

    it("sends a TipTap doc description as markdown", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 102 } }));

      await adapter.createIssue({
        title: "Iteration failed",
        projectId: "5",
        description: TIPTAP_DOC,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.issue.description).toBe(TIPTAP_DOC_MARKDOWN);
    });

    it("sends custom field values and leaves out empty ones and other keys", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 101 } }));

      await adapter.createIssue({
        title: "x",
        projectId: "5",
        customFields: {
          "1": "2026.11",
          "2": ["Firefox", "Safari"],
          "3": 3,
          "4": "",
          "5": [],
          reporter: { accountId: "8" },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.issue.custom_fields).toEqual([
        { id: 1, value: "2026.11" },
        { id: 2, value: ["Firefox", "Safari"] },
        { id: 3, value: "3" },
      ]);
    });
  });

  describe("getIssueTypeFields", () => {
    const def = (overrides: Record<string, unknown>) => ({
      customized_type: "issue",
      field_format: "string",
      is_required: false,
      is_for_all: true,
      multiple: false,
      default_value: "",
      trackers: [{ id: 2, name: "Bug" }],
      ...overrides,
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    /** Answer each endpoint by URL; a missing entry is a 403. */
    function respond(routes: Record<string, unknown>) {
      mockFetch.mockImplementation(async (url: string) => {
        const match = Object.keys(routes).find((path) => url.includes(path));
        return match ? okJson(routes[match]) : httpError(403, "Forbidden");
      });
    }

    it("lists the fields of the project and tracker, typed for the form", async () => {
      await authenticate();
      respond({
        "/projects/web.json": {
          project: {
            id: 5,
            identifier: "web",
            name: "Web",
            issue_custom_fields: [{ id: 20, name: "Listed" }],
          },
        },
        "/custom_fields.json": {
          custom_fields: [
            def({
              id: 1,
              name: "Build",
              is_required: true,
              default_value: "n/a",
            }),
            def({ id: 2, name: "Notes", field_format: "text" }),
            def({
              id: 3,
              name: "Retries",
              field_format: "int",
              default_value: "2",
            }),
            def({ id: 4, name: "Found on", field_format: "date" }),
            def({
              id: 5,
              name: "Blocked",
              field_format: "bool",
              default_value: "0",
              possible_values: [
                { value: "1", label: "Yes" },
                { value: "0", label: "No" },
              ],
            }),
            def({
              id: 6,
              name: "Browsers",
              field_format: "list",
              multiple: true,
              default_value: "Safari",
              possible_values: [
                { value: "Firefox", label: "Firefox" },
                { value: "Safari", label: "Safari" },
              ],
            }),
            def({
              id: 7,
              name: "Severity",
              field_format: "enumeration",
              possible_values: [{ value: "11", label: "Major" }],
            }),
            def({ id: 8, name: "Fixed in", field_format: "version" }),
            def({ id: 9, name: "Owner", field_format: "user" }),
            def({ id: 10, name: "Log", field_format: "attachment" }),
            def({ id: 11, name: "Other tracker", trackers: [{ id: 3 }] }),
            def({ id: 12, name: "Other project", is_for_all: false }),
            def({ id: 13, name: "Project field", customized_type: "project" }),
            def({ id: 20, name: "Listed", is_for_all: false }),
            def({
              id: 21,
              name: "By project",
              is_for_all: false,
              projects: [{ id: 5, name: "Web" }],
            }),
          ],
        },
        "/projects/web/versions.json": {
          versions: [
            { id: 31, name: "1.0", status: "closed" },
            { id: 32, name: "1.1", status: "open" },
          ],
        },
        "/projects/web/memberships.json": {
          memberships: [
            { user: { id: 8, name: "Ada Lovelace" } },
            { group: { id: 9, name: "QA" } },
          ],
        },
      });

      const fields = await adapter.getIssueTypeFields("web", "2");
      const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

      expect(fields.map((f) => f.name)).toEqual([
        "Build",
        "Notes",
        "Retries",
        "Found on",
        "Blocked",
        "Browsers",
        "Severity",
        "Fixed in",
        "Owner",
        "Listed",
        "By project",
      ]);
      expect(byName.Build).toMatchObject({
        key: "1",
        required: true,
        schema: { type: "string" },
        defaultValue: "n/a",
      });
      expect(byName.Notes.input).toBe("textarea");
      expect(byName.Retries).toMatchObject({
        schema: { type: "number" },
        defaultValue: 2,
      });
      expect(byName["Found on"].input).toBe("date");
      expect(byName.Blocked).toMatchObject({
        allowedValues: [
          { id: "1", name: "Yes" },
          { id: "0", name: "No" },
        ],
        defaultValue: "0",
      });
      expect(byName.Browsers).toMatchObject({
        input: "multiselect",
        defaultValue: ["Safari"],
      });
      expect(byName.Severity.allowedValues).toEqual([
        { id: "11", name: "Major" },
      ]);
      expect(byName["Fixed in"].allowedValues).toEqual([
        { id: "32", name: "1.1" },
      ]);
      expect(byName.Owner.allowedValues).toEqual([
        { id: "8", name: "Ada Lovelace" },
      ]);
    });

    it("offers the project's fields as text inputs when the key is not an administrator's", async () => {
      await authenticate();
      respond({
        "/projects/web.json": {
          project: {
            id: 5,
            identifier: "web",
            name: "Web",
            issue_custom_fields: [{ id: 1, name: "Build" }],
          },
        },
      });

      expect(await adapter.getIssueTypeFields("web", "2")).toEqual([
        {
          key: "1",
          name: "Build",
          required: false,
          hasDefaultValue: false,
          schema: { type: "string" },
        },
      ]);
    });

    it("returns no fields when the project cannot be read", async () => {
      await authenticate();
      respond({});

      expect(await adapter.getIssueTypeFields("web", "2")).toEqual([]);
    });
  });

  describe("updateIssue", () => {
    it("PUTs changed fields then re-fetches the issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(noContent()); // PUT
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 42, subject: "Updated" } })
      ); // GET

      const result = await adapter.updateIssue("#42", { title: "Updated" });

      const [putUrl, putOpts] = mockFetch.mock.calls[0];
      expect(putUrl).toBe(`${BASE_URL}/issues/42.json`);
      expect(putOpts.method).toBe("PUT");
      expect(JSON.parse(putOpts.body)).toEqual({
        issue: { subject: "Updated" },
      });
      expect(result.title).toBe("Updated");
    });

    it("sends a TipTap doc description as markdown", async () => {
      await authenticate();
      mockFetch
        .mockResolvedValueOnce(noContent())
        .mockResolvedValueOnce(okJson({ issue: { id: 42 } }));

      await adapter.updateIssue("#42", { description: TIPTAP_DOC });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.issue.description).toBe(TIPTAP_DOC_MARKDOWN);
    });

    it("resolves a status name to a status id", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue_statuses: [
            { id: 1, name: "New" },
            { id: 3, name: "Closed" },
          ],
        })
      ); // getStatuses
      mockFetch.mockResolvedValueOnce(noContent()); // PUT
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 42, status: { id: 3, name: "Closed" } } })
      ); // GET

      await adapter.updateIssue("42", { status: "Closed" });

      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        issue: { status_id: 3 },
      });
    });
  });

  describe("getIssueComments", () => {
    it("returns journal notes, skipping empty entries", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 5,
            journals: [
              {
                id: 1,
                notes: "first note",
                user: { id: 2, name: "Bob" },
                created_on: "2024-01-01",
              },
              { id: 2, notes: "", user: { id: 3, name: "Quiet" } },
            ],
          },
        })
      );

      const comments = await adapter.getIssueComments("5");

      expect(mockFetch.mock.calls[0][0]).toContain("include=journals");
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
    it("maps relations with direction relative to the source issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 10,
            relations: [
              {
                id: 1,
                issue_id: 10,
                issue_to_id: 20,
                relation_type: "relates",
              },
              { id: 2, issue_id: 5, issue_to_id: 10, relation_type: "blocks" },
            ],
          },
        })
      );

      const links = await adapter.getLinkedIssues("10");

      expect(links).toEqual([
        { id: "20", key: "#20", linkType: "relates", direction: "outward" },
        { id: "5", key: "#5", linkType: "blocks", direction: "inward" },
      ]);
    });
  });

  describe("attachments", () => {
    it("uploadAttachment sends the bytes, then attaches the token to the issue", async () => {
      await authenticate();
      mockFetch
        .mockResolvedValueOnce(
          okJson({
            upload: { id: 7, token: "7.ed1ccdb093229ca1bd0b043618d88743" },
          })
        )
        .mockResolvedValueOnce(noContent());

      const result = await adapter.uploadAttachment(
        "#42",
        Buffer.from([1, 2, 3]),
        "screen shot.png"
      );

      const [uploadUrl, uploadOpts] = mockFetch.mock.calls[0];
      expect(uploadUrl).toBe(
        `${BASE_URL}/uploads.json?filename=screen%20shot.png`
      );
      expect(uploadOpts.method).toBe("POST");
      expect(uploadOpts.headers["Content-Type"]).toBe(
        "application/octet-stream"
      );
      expect(uploadOpts.headers["X-Redmine-API-Key"]).toBe("test-key");
      expect([...uploadOpts.body]).toEqual([1, 2, 3]);

      const [attachUrl, attachOpts] = mockFetch.mock.calls[1];
      expect(attachUrl).toBe(`${BASE_URL}/issues/42.json`);
      expect(attachOpts.method).toBe("PUT");
      expect(JSON.parse(attachOpts.body)).toEqual({
        issue: {
          uploads: [
            {
              token: "7.ed1ccdb093229ca1bd0b043618d88743",
              filename: "screen shot.png",
            },
          ],
        },
      });
      expect(result).toEqual({ id: "7", url: `${BASE_URL}/attachments/7` });
    });

    it("uploadAttachment reads the attachment id from the token when none is returned", async () => {
      await authenticate();
      mockFetch
        .mockResolvedValueOnce(okJson({ upload: { token: "9.abcdef" } }))
        .mockResolvedValueOnce(noContent());

      const result = await adapter.uploadAttachment(
        "42",
        Buffer.from([1]),
        "a.txt"
      );

      expect(result.id).toBe("9");
    });

    it("uploadAttachment surfaces Redmine's refusal of an oversized file", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        httpError(
          422,
          '{"errors":["This file cannot be uploaded because it exceeds the maximum allowed file size (5242880)"]}'
        )
      );

      await expect(
        adapter.uploadAttachment("42", Buffer.from([1]), "big.mp4")
      ).rejects.toThrow("exceeds the maximum allowed file size");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("uploadAttachment fails when no token comes back", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({}));

      await expect(
        adapter.uploadAttachment("42", Buffer.from([1]), "a.txt")
      ).rejects.toThrow("upload token");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("listAttachments maps the issue's attachments", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 42,
            attachments: [
              {
                id: 1,
                filename: "screenshot one.png",
                filesize: 97,
                content_type: "image/png",
                content_url:
                  "http://localhost:3000/attachments/download/1/screenshot%20one.png",
                created_on: "2026-11-27T14:26:00Z",
              },
              { id: 2, filename: "notes.txt", filesize: 51 },
            ],
          },
        })
      );

      const result = await adapter.listAttachments("#42");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${BASE_URL}/issues/42.json?include=attachments`
      );
      expect(result).toEqual([
        {
          id: "1",
          filename: "screenshot one.png",
          mimeType: "image/png",
          byteSize: 97,
          createdAt: new Date("2026-11-27T14:26:00Z"),
          contentUrl: `${BASE_URL}/attachments/download/1`,
        },
        {
          id: "2",
          filename: "notes.txt",
          mimeType: undefined,
          byteSize: 51,
          createdAt: undefined,
          contentUrl: `${BASE_URL}/attachments/download/2`,
        },
      ]);
    });

    it("listAttachments returns an empty list for an issue without any", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 42 } }));

      await expect(adapter.listAttachments("42")).resolves.toEqual([]);
    });

    it("downloadAttachment fetches from the configured instance with the API key", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(binary([1, 2, 3], "image/png"));

      const result = await adapter.downloadAttachment({
        id: "1",
        filename: "screenshot one.png",
        contentUrl: "https://elsewhere.example.com/attachments/download/1",
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/attachments/download/1`);
      expect(opts.headers["X-Redmine-API-Key"]).toBe("test-key");
      expect(result.mimeType).toBe("image/png");
      expect([...result.buffer]).toEqual([1, 2, 3]);
    });

    it("downloadAttachment falls back to the listed type for a generic content type", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(binary([1], "application/octet-stream"));

      const result = await adapter.downloadAttachment({
        id: "1",
        filename: "shot.png",
        mimeType: "image/png",
      });

      expect(result.mimeType).toBe("image/png");
    });

    it("downloadAttachment refuses a file over the size cap", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(11 * 1024 * 1024) }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      await expect(
        adapter.downloadAttachment({ id: "1", filename: "big.bin" })
      ).rejects.toThrow("Binary response too large");
    });
  });

  describe("milestones", () => {
    const VERSIONS = {
      versions: [
        {
          id: 3,
          project: { id: 2, name: "Sample" },
          name: "1.0",
          description: "Open version",
          status: "open",
          due_date: "2026-12-31",
          sharing: "none",
        },
        {
          id: 4,
          project: { id: 2, name: "Sample" },
          name: "0.9",
          description: "",
          status: "closed",
          due_date: "2026-10-01",
        },
        {
          id: 5,
          project: { id: 9, name: "Shared from another project" },
          name: "1.1",
          status: "locked",
          due_date: null,
        },
      ],
      total_count: 3,
    };

    it("getExternalMilestones maps open and locked versions as active releases", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson(VERSIONS));

      const result = await adapter.getExternalMilestones({
        projectKey: "sample-project",
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${BASE_URL}/projects/sample-project/versions.json`
      );
      expect(result).toEqual({
        items: [
          {
            id: "3",
            kind: "RELEASE",
            name: "1.0",
            description: "Open version",
            endDate: new Date("2026-12-31T00:00:00.000Z"),
            state: "ACTIVE",
            rawState: "open",
            url: `${BASE_URL}/versions/3`,
          },
          {
            id: "5",
            kind: "RELEASE",
            name: "1.1",
            description: undefined,
            endDate: undefined,
            state: "ACTIVE",
            rawState: "locked",
            url: `${BASE_URL}/versions/5`,
          },
        ],
        hasMore: false,
      });
    });

    it("getExternalMilestones includes closed versions when asked", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson(VERSIONS));

      const { items } = await adapter.getExternalMilestones({
        projectKey: "sample-project",
        kind: "RELEASE",
        includeClosed: true,
      });

      expect(items.map((item) => [item.id, item.state, item.rawState])).toEqual(
        [
          ["3", "ACTIVE", "open"],
          ["4", "CLOSED", "closed"],
          ["5", "ACTIVE", "locked"],
        ]
      );
      expect(items[1].description).toBeUndefined();
      expect(items[1].endDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    });

    it("getExternalMilestones has no iterations and makes no request for them", async () => {
      await authenticate();

      await expect(
        adapter.getExternalMilestones({
          projectKey: "sample-project",
          kind: "ITERATION",
        })
      ).resolves.toEqual({ items: [], hasMore: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("getMilestoneIssues asks for open and closed issues of the version and pages by offset", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 11,
              subject: "Closed one",
              status: { id: 5, name: "Closed" },
            },
            { id: 10, subject: "Open one", status: { id: 1, name: "New" } },
          ],
          total_count: 3,
          offset: 0,
          limit: 2,
        })
      );

      const first = await adapter.getMilestoneIssues(
        { id: "3", kind: "RELEASE" },
        { limit: 2 }
      );

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(`${BASE_URL}/issues.json`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        fixed_version_id: "3",
        status_id: "*",
        limit: "2",
        offset: "0",
      });
      expect(first.issues.map((issue) => [issue.id, issue.key])).toEqual([
        ["11", "#11"],
        ["10", "#10"],
      ]);
      expect(first.total).toBe(3);
      expect(first.hasMore).toBe(true);
      expect(first.nextPageToken).toBe("2");

      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [{ id: 9, subject: "Last", status: { id: 1, name: "New" } }],
          total_count: 3,
        })
      );

      const second = await adapter.getMilestoneIssues(
        { id: "3", kind: "RELEASE" },
        { limit: 2, pageToken: first.nextPageToken }
      );

      expect(
        new URL(mockFetch.mock.calls[1][0]).searchParams.get("offset")
      ).toBe("2");
      expect(second.issues.map((issue) => issue.id)).toEqual(["9"]);
      expect(second.hasMore).toBe(false);
      expect(second.nextPageToken).toBeUndefined();
    });

    it("getMilestoneIssues never asks for more than Redmine's page maximum", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [], total_count: 0 }));

      const result = await adapter.getMilestoneIssues(
        { id: "3", kind: "RELEASE" },
        { limit: 500 }
      );

      expect(
        new URL(mockFetch.mock.calls[0][0]).searchParams.get("limit")
      ).toBe("100");
      expect(result).toEqual({
        issues: [],
        total: 0,
        hasMore: false,
        nextPageToken: undefined,
      });
    });

    it("getMilestoneIssues returns nothing for an iteration or a foreign id", async () => {
      await authenticate();

      await expect(
        adapter.getMilestoneIssues({ id: "3", kind: "ITERATION" })
      ).resolves.toEqual({ issues: [], hasMore: false });
      await expect(
        adapter.getMilestoneIssues({ id: "owner/repo#3", kind: "RELEASE" })
      ).resolves.toEqual({ issues: [], hasMore: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("metadata lookups", () => {
    it("getProjects maps id/identifier/name", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          projects: [{ id: 1, identifier: "web", name: "Website" }],
        })
      );

      expect(await adapter.getProjects()).toEqual([
        { id: "1", key: "web", name: "Website" },
      ]);
    });

    it("getProjects pages with offset until total_count is reached", async () => {
      await authenticate();
      const page = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({
          id: from + i + 1,
          identifier: `p${from + i + 1}`,
          name: `P${from + i + 1}`,
        }));
      mockFetch
        .mockResolvedValueOnce(
          okJson({ projects: page(0, 100), total_count: 101 })
        )
        .mockResolvedValueOnce(
          okJson({ projects: page(100, 1), total_count: 101 })
        );

      const projects = await adapter.getProjects();

      expect(projects).toHaveLength(101);
      expect(projects[100]).toEqual({ id: "101", key: "p101", name: "P101" });
      expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
        `${BASE_URL}/projects.json?limit=100&offset=0`,
        `${BASE_URL}/projects.json?limit=100&offset=100`,
      ]);
    });

    it("getIssueTypes maps trackers", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          trackers: [
            { id: 1, name: "Bug" },
            { id: 2, name: "Feature" },
          ],
        })
      );

      expect(await adapter.getIssueTypes("any")).toEqual([
        { id: "1", name: "Bug" },
        { id: "2", name: "Feature" },
      ]);
    });

    it("getStatuses maps issue_statuses", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue_statuses: [{ id: 1, name: "New" }] })
      );

      expect(await adapter.getStatuses()).toEqual([{ id: "1", name: "New" }]);
    });

    it("getPriorities maps issue_priorities", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue_priorities: [{ id: 4, name: "High" }] })
      );

      expect(await adapter.getPriorities()).toEqual([
        { id: "4", name: "High" },
      ]);
    });
  });

  describe("user lookups", () => {
    it("searchUsers fails soft on 403 (non-admin key)", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(403, "Forbidden"));

      await expect(adapter.searchUsers("bob")).resolves.toEqual([]);
    });

    it("searchUsers lists users without a name filter when the query is blank", async () => {
      await authenticate();
      mockFetch.mockResolvedValue(
        okJson({ users: [{ id: 7, firstname: "Ada", lastname: "Lovelace" }] })
      );

      const listed = await adapter.searchUsers("");
      const blankUrl = String(mockFetch.mock.calls.at(-1)?.[0]);
      await adapter.searchUsers("ada");
      const namedUrl = String(mockFetch.mock.calls.at(-1)?.[0]);

      expect(listed).toHaveLength(1);
      expect(blankUrl).toContain("/users.json?limit=20");
      expect(blankUrl).not.toContain("name=");
      expect(namedUrl).toContain("name=ada");
    });

    it("getCurrentUser returns the authenticated user", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          user: {
            id: 1,
            firstname: "Ada",
            lastname: "Lovelace",
            mail: "ada@x.io",
          },
        })
      );

      expect(await adapter.getCurrentUser()).toEqual({
        accountId: "1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@x.io",
      });
    });
  });

  describe("linkToTestCase", () => {
    it("adds a note via PUT and swallows failures", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(noContent());

      await adapter.linkToTestCase("#42", "TC-1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/issues/42.json`);
      expect(opts.method).toBe("PUT");
      expect(JSON.parse(opts.body).issue.notes).toContain("TC-1");
    });
  });
});
