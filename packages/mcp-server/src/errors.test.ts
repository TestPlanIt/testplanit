import { describe, it, expect } from "vitest";
import { mapHttpErrorToToolResult, type ToolErrorResult } from "./errors.js";
import { TestPlanItHttpError } from "./http.js";

describe("mapHttpErrorToToolResult", () => {
  describe("READ_ONLY_TOKEN — T-05-01 mitigation", () => {
    it("returns isError:true with a message naming mode:read and read-only", () => {
      const err = new TestPlanItHttpError("Read-only token", {
        statusCode: 403,
        code: "READ_ONLY_TOKEN",
      });
      const result: ToolErrorResult = mapHttpErrorToToolResult(err);

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      // Must name the scope so agents can fix the token.
      expect(result.content[0].text).toContain("mode:read");
      // Human-readable concept (case-insensitive).
      expect(result.content[0].text.toLowerCase()).toContain("read-only");
    });
  });

  describe("known errorCode translations", () => {
    const KNOWN_CODES: Array<{ code: string; statusCode: number }> = [
      { code: "NO_TOKEN", statusCode: 401 },
      { code: "INVALID_FORMAT", statusCode: 401 },
      { code: "INVALID_TOKEN", statusCode: 401 },
      { code: "EXPIRED_TOKEN", statusCode: 401 },
      { code: "INACTIVE_TOKEN", statusCode: 401 },
      { code: "INACTIVE_USER", statusCode: 403 },
      { code: "API_ACCESS_DISABLED", statusCode: 403 },
      { code: "READ_ONLY_TOKEN", statusCode: 403 },
    ];

    for (const { code, statusCode } of KNOWN_CODES) {
      it(`translates code=${code} (status ${statusCode}) to a friendly message including the code`, () => {
        const err = new TestPlanItHttpError(`upstream rejected: ${code}`, {
          statusCode,
          code,
        });
        const result = mapHttpErrorToToolResult(err);
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        // Friendly text MUST include the upstream code so operators can grep
        // logs and trace back to lib/api-token-auth.ts.
        expect(result.content[0].text).toContain(code);
      });
    }
  });

  describe("unknown errorCode fallback", () => {
    it("returns isError:true with a generic message including the status code", () => {
      const err = new TestPlanItHttpError("weird upstream error", {
        statusCode: 500,
      });
      const result = mapHttpErrorToToolResult(err);
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      // Status code surfaces so operators know it was an HTTP failure.
      expect(result.content[0].text).toContain("500");
      expect(result.content[0].text.toLowerCase()).toContain("weird upstream error");
    });

    it("handles a TestPlanItHttpError with no statusCode and no code", () => {
      const err = new TestPlanItHttpError("mystery failure");
      const result = mapHttpErrorToToolResult(err);
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      // Should still surface the message without throwing.
      expect(result.content[0].text.toLowerCase()).toContain("mystery failure");
    });
  });

  describe("network / runtime error fallback", () => {
    it("returns isError:true with a network-related message for a plain Error", () => {
      const err = new Error("ECONNREFUSED");
      const result = mapHttpErrorToToolResult(err);
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text.toLowerCase()).toMatch(
        /network|runtime/,
      );
      expect(result.content[0].text).toContain("ECONNREFUSED");
    });

    it("returns isError:true with an Unknown error message for a non-Error throwable", () => {
      const result = mapHttpErrorToToolResult("string thrown");
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text.toLowerCase()).toContain("unknown");
    });
  });

  describe("token redaction defense in depth (T-05-06 package side)", () => {
    it("does not echo a raw tpi_ token if one accidentally appears in the error message", () => {
      // Defense-in-depth: even though http.ts already redacts before
      // constructing the error, the MCP layer must not echo a raw token
      // back to the agent if the message ever contains one.
      const err = new TestPlanItHttpError(
        "rejected: tpi_supersecretvalue is bad",
        { statusCode: 401, code: "INVALID_TOKEN" },
      );
      const result = mapHttpErrorToToolResult(err);
      // Friendly translations MUST exist for known codes — the friendly
      // text never contains the offending token because it's a fixed
      // template, not the raw err.message.
      expect(result.content[0].text).not.toContain("tpi_supersecretvalue");
    });
  });
});
