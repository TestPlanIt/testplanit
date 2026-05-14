import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch — pattern mirrors packages/api/src/client.test.ts.
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

import { validateToken } from "./http.js";

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

const errorResponse = (status: number, body: unknown) => ({
  ok: false,
  status,
  text: async () =>
    typeof body === "string" ? body : JSON.stringify(body),
});

describe("validateToken", () => {
  it("returns ok:true with the parsed user on a 200 whoami response", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: "u_1",
        name: "Alice",
        email: "a@example.com",
        scopes: [],
        readOnly: false,
        isAgent: false,
      }),
    );
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("u_1");
      expect(result.user.name).toBe("Alice");
      expect(result.user.email).toBe("a@example.com");
      expect(result.user.scopes).toEqual([]);
      expect(result.user.readOnly).toBe(false);
      expect(result.user.isAgent).toBe(false);
    }
  });

  it("calls fetch with /api/auth/whoami and Bearer + Content-Type headers", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: "u_1",
        name: null,
        email: "a@example.com",
        scopes: [],
        readOnly: false,
        isAgent: false,
      }),
    );
    await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    // url may be a URL object or string — coerce to string for assertion.
    expect(String(url)).toContain("/api/auth/whoami");
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tpi_x",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("returns the wider failure shape on 401 INVALID_TOKEN with code + statusCode populated", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, { error: "Invalid token", code: "INVALID_TOKEN" }),
    );
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_TOKEN");
      expect(result.statusCode).toBe(401);
      expect(result.message).toBeTruthy();
      expect(result.message).toContain("INVALID_TOKEN");
      // Token string sanity — must not be the raw token value.
      expect(result.message).not.toContain("tpi_x ");
    }
  });

  it("returns the wider failure shape on 403 READ_ONLY_TOKEN — plan 05-07 consumes this directly", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(403, {
        error: "Token is read-only",
        code: "READ_ONLY_TOKEN",
      }),
    );
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("READ_ONLY_TOKEN");
      expect(result.statusCode).toBe(403);
    }
  });

  it("returns code=EXPIRED_TOKEN, statusCode=401 on an expired token response", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, {
        error: "Token has expired",
        code: "EXPIRED_TOKEN",
      }),
    );
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXPIRED_TOKEN");
      expect(result.statusCode).toBe(401);
      expect(result.message).toMatch(/EXPIRED_TOKEN|401/);
    }
  });

  it("returns ok:false with a network-related message on transport failure (no statusCode/code)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Network|ECONNREFUSED/);
      expect(result.statusCode).toBeUndefined();
      expect(result.code).toBeUndefined();
    }
  });

  it("returns ok:false when a 200 body is not valid JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<not json>",
    });
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
    }
  });

  it("returns ok:false with statusCode=502 and undefined code when error body is not parseable JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(502, "<html>Bad Gateway</html>"),
    );
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(502);
      expect(result.code).toBeUndefined();
      expect(result.message).toBeTruthy();
    }
  });

  it("redacts the raw token from error messages (T-05-06)", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, { error: "Invalid", code: "INVALID_TOKEN" }),
    );
    const result = await validateToken({
      apiUrl: "https://example.com",
      apiToken: "tpi_supersecretvalue",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("supersecretvalue");
    }
  });
});
