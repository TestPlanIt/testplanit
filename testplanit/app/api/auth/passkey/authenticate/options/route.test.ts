// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAvailability,
  mockBuildOptions,
  mockCheckRateLimit,
  mockIsPasskeyOrigin,
} = vi.hoisted(() => ({
  mockAvailability: vi.fn(),
  mockBuildOptions: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockIsPasskeyOrigin: vi.fn(),
}));

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/lib/auth-security", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("~/lib/passkey", () => ({
  getPasskeyAvailability: mockAvailability,
  buildPasskeyAuthenticationOptions: mockBuildOptions,
  isPasskeyOrigin: mockIsPasskeyOrigin,
}));

import { POST } from "./route";

function makePost(ip = "203.0.113.7") {
  return new NextRequest(
    "http://localhost/api/auth/passkey/authenticate/options",
    {
      method: "POST",
      headers: { "x-forwarded-for": ip, origin: "http://localhost:3001" },
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAvailability.mockResolvedValue({ available: true });
  mockIsPasskeyOrigin.mockReturnValue(true);
  mockCheckRateLimit.mockResolvedValue(true);
  mockBuildOptions.mockResolvedValue({
    options: { challenge: "challenge-1", rpId: "localhost" },
    challengeToken: "token-1",
  });
});

describe("POST /api/auth/passkey/authenticate/options", () => {
  it("returns a challenge and the token to echo back", async () => {
    const response = await POST(makePost());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      options: { challenge: "challenge-1", rpId: "localhost" },
      challengeToken: "token-1",
    });
  });

  it("answers { enabled: false } while passkeys are unavailable", async () => {
    mockAvailability.mockResolvedValue({
      available: false,
      reason: "force_sso",
    });
    const response = await POST(makePost());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });

  it("issues no challenge to a page on another address than the configured one", async () => {
    mockIsPasskeyOrigin.mockReturnValue(false);
    const response = await POST(makePost());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      reason: "address_mismatch",
    });
    expect(mockIsPasskeyOrigin).toHaveBeenCalledWith("http://localhost:3001");
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });

  it("limits requests per address", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    const response = await POST(makePost("198.51.100.9"));

    expect(response.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "passkey:options:ip:198.51.100.9",
      expect.objectContaining({ maxAttempts: 20 })
    );
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });
});
