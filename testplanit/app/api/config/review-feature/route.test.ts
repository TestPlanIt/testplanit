import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * Tests for GET /api/config/review-feature.
 *
 * The system-level review feature flag is admin-toggleable via the
 * `review_feature_enabled` AppConfig row. This route reads the row
 * server-side and serves the resolved boolean to clients so the value
 * never ships in the client bundle.
 *
 * Default-on convention (matches assertReviewGatePasses):
 *   - row missing       → enabled (true)
 *   - value === false   → disabled (false)
 *   - anything else     → enabled (true)
 */
vi.mock("~/lib/prisma", () => ({
  prisma: {
    appConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "~/lib/prisma";

describe("GET /api/config/review-feature", () => {
  const findUnique = prisma.appConfig.findUnique as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns { enabled: true } when the AppConfig row is missing", async () => {
    findUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: "review_feature_enabled" },
      select: { value: true },
    });
  });

  it("returns { enabled: false } when value === false", async () => {
    findUnique.mockResolvedValue({ value: false });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: false });
  });

  it("returns { enabled: true } when value === true", async () => {
    findUnique.mockResolvedValue({ value: true });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
  });

  it("returns { enabled: true } for any non-false JSON value (forward-compat with future shapes)", async () => {
    for (const value of [0, "false", { enabled: false }, []]) {
      findUnique.mockResolvedValue({ value });
      const response = await GET();
      const body = await response.json();
      expect(body).toEqual({ enabled: true });
    }
  });

  it("returns a JSON body shaped exactly as { enabled: boolean } with no other fields", async () => {
    findUnique.mockResolvedValue({ value: true });

    const response = await GET();
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(["enabled"]);
    expect(typeof body.enabled).toBe("boolean");
  });
});
