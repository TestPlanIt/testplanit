import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCspViolationLog } from "~/lib/cspReportLog";
import { POST } from "./route";

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost:3000/api/csp-report", {
      method: "POST",
      body,
      headers: { "content-type": "application/csp-report", ...headers },
    })
  );

describe("POST /api/csp-report", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.CSP_MODE;
    resetCspViolationLog();
  });

  afterEach(() => {
    warn.mockRestore();
    delete process.env.CSP_MODE;
  });

  it("logs a legacy report-uri body as one line", async () => {
    const response = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://tpi.example.com/en-US/projects",
          "effective-directive": "script-src",
          "blocked-uri": "inline",
          "source-file": "https://tpi.example.com/en-US/projects",
          "line-number": 12,
          "script-sample": "alert(1)",
        },
      })
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const [label, json] = warn.mock.calls[0];
    expect(label).toBe("[csp] violation");
    expect(JSON.parse(json as string)).toEqual({
      documentUri: "https://tpi.example.com/en-US/projects",
      violatedDirective: "script-src",
      blockedUri: "inline",
      sourceFile: "https://tpi.example.com/en-US/projects",
      line: 12,
      sample: "alert(1)",
    });
  });

  it("logs each entry of a Reporting API batch", async () => {
    const response = await post(
      JSON.stringify([
        {
          type: "csp-violation",
          body: {
            documentURL: "https://tpi.example.com/a",
            effectiveDirective: "img-src",
            blockedURL: "https://evil.example.com/x.png",
            disposition: "report",
          },
        },
        { type: "deprecation", body: { id: "x" } },
        {
          type: "csp-violation",
          body: {
            documentURL: "https://tpi.example.com/b",
            effectiveDirective: "connect-src",
            blockedURL: "wss://other.example.com",
          },
        },
      ]),
      { "content-type": "application/reports+json" }
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(warn.mock.calls[0][1] as string).violatedDirective).toBe(
      "img-src"
    );
    expect(JSON.parse(warn.mock.calls[1][1] as string).blockedUri).toBe(
      "wss://other.example.com"
    );
  });

  it("logs a repeated violation once", async () => {
    const body = JSON.stringify({
      "csp-report": {
        "effective-directive": "script-src",
        "blocked-uri": "eval",
        "source-file": "https://tpi.example.com/_next/static/chunks/a.js",
        "line-number": 1,
        "column-number": 4438,
      },
    });
    for (let i = 0; i < 5; i++) await post(body);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects bodies that are not JSON", async () => {
    const response = await post("<html>");
    expect(response.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const response = await post("x".repeat(17 * 1024));
    expect(response.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops reports when the policy is off", async () => {
    process.env.CSP_MODE = "off";
    const response = await post(
      JSON.stringify({ "csp-report": { "effective-directive": "script-src" } })
    );
    expect(response.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
