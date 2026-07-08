import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adfToWikiMarkup,
  buildAuthHeader,
  detectJiraDeployment,
  pickUserId,
  resolveAuthScheme,
  userRefField,
} from "./jiraDeployment";

// Small ADF builders so the wiki-markup expectations below read as content,
// not as nested JSON noise.
const doc = (...content: any[]) => ({ type: "doc", version: 1, content });
const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const para = (...content: any[]) => ({ type: "paragraph", content });
const li = (...content: any[]) => ({ type: "listItem", content });

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

  describe("adfToWikiMarkup", () => {
    it("returns an empty string for empty / non-doc input", () => {
      expect(adfToWikiMarkup(null)).toBe("");
      expect(adfToWikiMarkup(undefined)).toBe("");
      expect(adfToWikiMarkup({})).toBe("");
      expect(adfToWikiMarkup(doc())).toBe("");
    });

    it("emits a plain paragraph as its text (no wrapping markup)", () => {
      expect(adfToWikiMarkup(doc(para(text("just words"))))).toBe("just words");
    });

    it("maps inline marks to wiki syntax", () => {
      expect(adfToWikiMarkup(doc(para(text("x", "strong"))))).toBe("*x*");
      expect(adfToWikiMarkup(doc(para(text("x", "em"))))).toBe("_x_");
      expect(adfToWikiMarkup(doc(para(text("x", "underline"))))).toBe("+x+");
      expect(adfToWikiMarkup(doc(para(text("x", "strike"))))).toBe("-x-");
      expect(adfToWikiMarkup(doc(para(text("x", "code"))))).toBe("{{x}}");
    });

    it("accepts raw TipTap mark names (bold/italic) as well as ADF names", () => {
      expect(adfToWikiMarkup(doc(para(text("x", "bold"))))).toBe("*x*");
      expect(adfToWikiMarkup(doc(para(text("x", "italic"))))).toBe("_x_");
    });

    it("nests multiple marks on one run (marks apply in array order)", () => {
      // strong then em wraps strong first, em outside — Jira renders either
      // nesting identically, so we just pin the deterministic output.
      expect(adfToWikiMarkup(doc(para(text("x", "strong", "em"))))).toBe("_*x*_");
    });

    it("renders a link as [text|href], and plain text when href is absent", () => {
      expect(
        adfToWikiMarkup(
          doc(
            para({
              type: "text",
              text: "site",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            })
          )
        )
      ).toBe("[site|https://example.com]");
      expect(
        adfToWikiMarkup(doc(para({ type: "text", text: "x", marks: [{ type: "link" }] })))
      ).toBe("x");
    });

    it("preserves surrounding text around a marked run", () => {
      expect(
        adfToWikiMarkup(
          doc(para(text("a "), text("bold", "strong"), text(" b")))
        )
      ).toBe("a *bold* b");
    });

    it("renders headings with the right level, clamped to h1..h6", () => {
      expect(
        adfToWikiMarkup(doc({ type: "heading", attrs: { level: 2 }, content: [text("Title")] }))
      ).toBe("h2. Title");
      expect(
        adfToWikiMarkup(doc({ type: "heading", attrs: { level: 9 }, content: [text("Deep")] }))
      ).toBe("h6. Deep");
    });

    it("renders bullet and ordered lists", () => {
      expect(
        adfToWikiMarkup(
          doc({
            type: "bulletList",
            content: [li(para(text("one"))), li(para(text("two")))],
          })
        )
      ).toBe("* one\n* two");
      expect(
        adfToWikiMarkup(
          doc({
            type: "orderedList",
            content: [li(para(text("first"))), li(para(text("second")))],
          })
        )
      ).toBe("# first\n# second");
    });

    it("renders nested and mixed lists with combined markers", () => {
      // An ordered item containing a bullet sub-list → the sub-items use the
      // combined "#*" prefix, matching Jira's own nesting syntax.
      expect(
        adfToWikiMarkup(
          doc({
            type: "orderedList",
            content: [
              li(
                para(text("outer")),
                {
                  type: "bulletList",
                  content: [li(para(text("inner")))],
                }
              ),
            ],
          })
        )
      ).toBe("# outer\n#* inner");
    });

    it("renders a code block with and without a language", () => {
      expect(
        adfToWikiMarkup(
          doc({
            type: "codeBlock",
            attrs: { language: "java" },
            content: [text("int x = 1;")],
          })
        )
      ).toBe("{code:java}\nint x = 1;\n{code}");
      expect(
        adfToWikiMarkup(
          doc({ type: "codeBlock", content: [text("plain code")] })
        )
      ).toBe("{code}\nplain code\n{code}");
    });

    it("renders block quotes and horizontal rules", () => {
      expect(
        adfToWikiMarkup(
          doc({ type: "blockquote", content: [para(text("quoted"))] })
        )
      ).toBe("{quote}\nquoted\n{quote}");
      expect(adfToWikiMarkup(doc({ type: "rule" }))).toBe("----");
    });

    it("maps hard breaks to newlines within a paragraph", () => {
      expect(
        adfToWikiMarkup(doc(para(text("line one"), { type: "hardBreak" }, text("line two"))))
      ).toBe("line one\nline two");
    });

    it("renders a table with a header row (||) and body rows (|)", () => {
      expect(
        adfToWikiMarkup(
          doc({
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableHeader", content: [para(text("A"))] },
                  { type: "tableHeader", content: [para(text("B"))] },
                ],
              },
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", content: [para(text("1"))] },
                  { type: "tableCell", content: [para(text("2"))] },
                ],
              },
            ],
          })
        )
      ).toBe("||A||B||\n|1|2|");
    });

    it("separates consecutive blocks with a single blank line", () => {
      expect(
        adfToWikiMarkup(
          doc(
            { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
            para(text("body"))
          )
        )
      ).toBe("h1. Title\n\nbody");
    });
  });
});
