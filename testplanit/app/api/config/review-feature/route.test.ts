import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * Tests for GET /api/config/review-feature.
 *
 * Per Phase 02 Plan 03 Task 1 + D-19:
 *   - The system-level review feature flag is operator-controlled via the
 *     `TESTPLANIT_REVIEW_FEATURE_ENABLED` env var. It MUST NOT be exposed as
 *     `NEXT_PUBLIC_*` (per RESEARCH §Pitfall 2) — instead, this route reads
 *     it server-side and serves the resolved boolean to clients.
 *
 * Env var convention (Assumption A6, matches assertReviewGatePasses):
 *   - Only the literal string 'false' disables the feature.
 *   - undefined / 'true' / '0' / 'no' / '' / any other value → enabled (true).
 */
describe("GET /api/config/review-feature", () => {
  const ENV_KEY = "TESTPLANIT_REVIEW_FEATURE_ENABLED";

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns { enabled: true } when the env var is unset", async () => {
    // Explicitly remove the var (vi.stubEnv with undefined clears it for this test)
    vi.stubEnv(ENV_KEY, "");
    delete process.env[ENV_KEY];

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
  });

  it("returns { enabled: false } when the env var is the literal string 'false'", async () => {
    vi.stubEnv(ENV_KEY, "false");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: false });
  });

  it("returns { enabled: true } when the env var is 'true'", async () => {
    vi.stubEnv(ENV_KEY, "true");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
  });

  it("returns { enabled: true } when the env var is '0' (off-by-one convention: only literal 'false' disables)", async () => {
    vi.stubEnv(ENV_KEY, "0");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
  });

  it("returns { enabled: true } when the env var is 'no' (only literal 'false' disables)", async () => {
    vi.stubEnv(ENV_KEY, "no");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
  });

  it("returns { enabled: true } when the env var is the empty string", async () => {
    vi.stubEnv(ENV_KEY, "");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ enabled: true });
  });

  it("returns a JSON body shaped exactly as { enabled: boolean } with no other fields", async () => {
    vi.stubEnv(ENV_KEY, "true");

    const response = await GET();
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(["enabled"]);
    expect(typeof body.enabled).toBe("boolean");
  });
});
