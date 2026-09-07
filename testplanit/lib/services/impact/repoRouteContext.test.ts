import { describe, expect, it } from "vitest";
import { providerErrorResponse } from "./repoRouteContext";

describe("providerErrorResponse", () => {
  it("reports a provider 404 as 404 so callers can say the ref was not found", async () => {
    const res = providerErrorResponse(
      new Error('HTTP 404 Not Found: {"message":"No commit found for SHA"}')
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'HTTP 404 Not Found: {"message":"No commit found for SHA"}',
    });
  });

  it("keeps every other provider failure at 502 with its message", async () => {
    const res = providerErrorResponse(
      new Error("HTTP 500 Internal Server Error: upstream exploded")
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "HTTP 500 Internal Server Error: upstream exploded",
    });
  });

  it("does not mistake a 404 mentioned later in the message for the status", async () => {
    const res = providerErrorResponse(
      new Error("Rate limit exceeded. Retry after HTTP 404 seconds")
    );

    expect(res.status).toBe(502);
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    const res = providerErrorResponse("boom");

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Repository request failed",
    });
  });
});
