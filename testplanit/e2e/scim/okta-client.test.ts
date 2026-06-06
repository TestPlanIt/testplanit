/**
 * Unit tests for the hand-rolled Okta REST client.
 *
 * Mocks the global `fetch` so the suite runs without a real Okta dev
 * tenant. Covers:
 *
 *   - Auth scheme (SSWS, NOT Bearer)
 *   - JSON headers (Accept / Content-Type)
 *   - Happy-path method routing (GET user/group, POST app assign, DELETE)
 *   - 429 retry-after handling (single retry; gives up on persistent 429)
 *   - Error-message scrubbing (no Authorization header value leaks)
 *   - Token safety (no import of @okta/okta-sdk-nodejs; no console of token)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OktaClient } from "./okta-client";

const ORG_URL = "https://dev-12345.okta.com";
const API_TOKEN = "ssws-secret-token-do-not-leak";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("OktaClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("Authorization scheme", () => {
    it("A1: getUser sends Authorization: SSWS <token>", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "u1" }));
      const client = new OktaClient(ORG_URL, API_TOKEN);
      await client.getUser("u1");
      const callArgs = fetchSpy.mock.calls[0];
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`SSWS ${API_TOKEN}`);
    });

    it("A2: Authorization header does NOT use Bearer scheme", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "u1" }));
      const client = new OktaClient(ORG_URL, API_TOKEN);
      await client.getUser("u1");
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).not.toMatch(/^Bearer\b/);
    });

    it("A3: sends Accept and Content-Type application/json", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "u1" }));
      const client = new OktaClient(ORG_URL, API_TOKEN);
      await client.getUser("u1");
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Accept).toBe("application/json");
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("Happy-path methods", () => {
    it("B1: getUser GETs /api/v1/users/<userId> and returns parsed JSON", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ id: "u1", profile: { login: "u1@example.com" } }),
      );
      const client = new OktaClient(ORG_URL, API_TOKEN);
      const result = await client.getUser("u1");
      expect(fetchSpy.mock.calls[0][0]).toBe(
        `${ORG_URL}/api/v1/users/u1`,
      );
      expect(result.id).toBe("u1");
    });

    it("B2: getGroup GETs /api/v1/groups/<groupId>", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ id: "g1", profile: { name: "Engineering" } }),
      );
      const client = new OktaClient(ORG_URL, API_TOKEN);
      const result = await client.getGroup("g1");
      expect(fetchSpy.mock.calls[0][0]).toBe(
        `${ORG_URL}/api/v1/groups/g1`,
      );
      expect(result.id).toBe("g1");
    });

    it("B3: assignUserToApp POSTs the SCIM-app users collection with profile", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "u1" }));
      const client = new OktaClient(ORG_URL, API_TOKEN);
      await client.assignUserToApp("app1", "u1", {
        userName: "u1@example.com",
        givenName: "Alice",
        familyName: "Example",
      });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${ORG_URL}/api/v1/apps/app1/users`);
      const reqInit = init as RequestInit;
      expect(reqInit.method).toBe("POST");
      const body = JSON.parse(reqInit.body as string);
      expect(body.id).toBe("u1");
      expect(body.scope).toBe("USER");
      expect(body.credentials.userName).toBe("u1@example.com");
      expect(body.profile.userName).toBe("u1@example.com");
    });

    it("B4: deleteUser DELETEs /api/v1/users/<userId>", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({}));
      const client = new OktaClient(ORG_URL, API_TOKEN);
      await client.deleteUser("u1");
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${ORG_URL}/api/v1/users/u1`);
      expect((init as RequestInit).method).toBe("DELETE");
    });
  });

  describe("429 retry handling", () => {
    it("C1: on 429 with Retry-After, sleeps then retries once and returns the success body", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "2" },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ id: "u1" }));

      const client = new OktaClient(ORG_URL, API_TOKEN);
      const promise = client.getUser("u1");
      // Advance the simulated sleep window past the 2s retry-after.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;
      expect(result.id).toBe("u1");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("C2: when the retry attempt also returns 429, the client throws (no infinite loop)", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "1" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("still rate limited", {
            status: 429,
            headers: { "Retry-After": "1" },
          }),
        );

      const client = new OktaClient(ORG_URL, API_TOKEN);
      const promise = client.getUser("u1");
      const assertion = expect(promise).rejects.toThrow(/429/);
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error scrubbing", () => {
    it("D1: non-2xx error message includes path + status + body but NOT the Authorization header value", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("E0000007 not found", { status: 404 }),
      );
      const client = new OktaClient(ORG_URL, API_TOKEN);
      let captured: Error | undefined;
      try {
        await client.getUser("ghost");
      } catch (err) {
        captured = err as Error;
      }
      expect(captured).toBeDefined();
      expect(captured?.message).toMatch(/404/);
      expect(captured?.message).toMatch(/\/api\/v1\/users\/ghost/);
      expect(captured?.message).toMatch(/E0000007 not found/);
      expect(captured?.message).not.toContain(API_TOKEN);
      expect(captured?.message).not.toMatch(/SSWS\s/);
    });
  });

  describe("Token safety", () => {
    it("E1: source does NOT import @okta/okta-sdk-nodejs", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const sourcePath = join(process.cwd(), "e2e/scim/okta-client.ts");
      const source = readFileSync(sourcePath, "utf8");
      // Reject only actual imports/requires of the SDK — the JSDoc may
      // mention the package name in prose to explain the hand-roll rationale.
      expect(source).not.toMatch(/^\s*import[\s\S]*?["']@okta\/okta-sdk/m);
      expect(source).not.toMatch(/require\(["']@okta\/okta-sdk/);
    });

    it("E2: source does NOT console-log the apiToken field", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const sourcePath = join(process.cwd(), "e2e/scim/okta-client.ts");
      const source = readFileSync(sourcePath, "utf8");
      expect(source).not.toMatch(/console\.[a-z]+\([^)]*apiToken/);
    });
  });
});
