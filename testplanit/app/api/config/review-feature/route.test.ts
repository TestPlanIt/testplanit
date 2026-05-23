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
 * Default-off convention (matches assertReviewGatePasses):
 *   - row missing       → disabled (false)
 *   - value === true    → enabled (true)
 *   - anything else     → disabled (false)
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

  it("returns { enabled: false } when the AppConfig row is missing (default-off, admin opts in)", async () => {
    findUnique.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: false });
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

  it("returns { enabled: false } for any value that isn't strictly true (default-off, forward-compat)", async () => {
    for (const value of [0, 1, "true", "false", { enabled: true }, [true]]) {
      findUnique.mockResolvedValue({ value });
      const response = await GET();
      const body = await response.json();
      expect(body).toEqual({ enabled: false });
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
