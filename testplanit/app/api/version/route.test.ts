import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/version", () => ({
  getVersionInfo: () => ({ version: "1.1.4" }),
}));

import { GET } from "./route";

describe("GET /api/version", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the build ID and version, uncached", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "89391f4-mgr1k2");

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      buildId: "89391f4-mgr1k2",
      version: "1.1.4",
    });
  });

  it("returns a null build ID when none was inlined", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", undefined);

    const body = await GET().json();

    expect(body.buildId).toBeNull();
  });
});
