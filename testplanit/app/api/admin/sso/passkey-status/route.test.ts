// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockRelyingParty } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRelyingParty: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ getServerAuthSession: mockGetSession }));
vi.mock("~/lib/passkey", () => ({ getPasskeyRelyingParty: mockRelyingParty }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    user: { id: "admin-1", access: "ADMIN" },
  });
  mockRelyingParty.mockReturnValue({
    rpID: "app.example.com",
    origin: "https://app.example.com",
    eligible: true,
  });
});

describe("GET /api/admin/sso/passkey-status", () => {
  it("reports configured when the application address can host passkeys", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true });
  });

  it("reports not configured for an address that cannot", async () => {
    mockRelyingParty.mockReturnValue({
      rpID: "192.168.1.5",
      origin: "http://192.168.1.5:3000",
      eligible: false,
    });
    const response = await GET();

    expect(await response.json()).toEqual({ configured: false });
  });

  it.each([
    ["a signed-out request", null],
    ["a non-admin", { user: { id: "user-1", access: "USER" } }],
  ])("refuses %s", async (_label, session) => {
    mockGetSession.mockResolvedValue(session);
    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockRelyingParty).not.toHaveBeenCalled();
  });
});
