import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/scim/tokens", () => ({
  getScimTokenById: vi.fn(),
  decryptScimSecret: vi.fn(),
}));

vi.mock("~/lib/scim/responses", () => ({
  getScimBaseUrl: () => "http://localhost:3000",
}));

import { decryptScimSecret, getScimTokenById } from "~/lib/scim/tokens";
import { probeScimToken } from "./probe";

const PLAINTEXT = "tps_test_plaintext_bearer_abc";

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tk_1",
    isActive: true,
    secret: "enc(tps_test_plaintext_bearer_abc)",
    ...overrides,
  } as any;
}

describe("probeScimToken", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns Token not found when the token does not exist", async () => {
    vi.mocked(getScimTokenById).mockResolvedValue(null);

    const result = await probeScimToken("missing");

    expect(result).toEqual({
      ok: false,
      status: 0,
      reason: "Token not found",
    });
    expect(decryptScimSecret).not.toHaveBeenCalled();
  });

  it("returns Token inactive when the row is marked inactive", async () => {
    vi.mocked(getScimTokenById).mockResolvedValue(
      activeRow({ isActive: false })
    );

    const result = await probeScimToken("tk_1");

    expect(result).toEqual({
      ok: false,
      status: 0,
      reason: "Token inactive",
    });
    expect(decryptScimSecret).not.toHaveBeenCalled();
  });

  it("returns ok=true on HTTP 200", async () => {
    vi.mocked(getScimTokenById).mockResolvedValue(activeRow());
    vi.mocked(decryptScimSecret).mockResolvedValue(PLAINTEXT);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const result = await probeScimToken("tk_1");

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok=false with HTTP <status> reason on a 401 response", async () => {
    vi.mocked(getScimTokenById).mockResolvedValue(activeRow());
    vi.mocked(decryptScimSecret).mockResolvedValue(PLAINTEXT);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 })
    );

    const result = await probeScimToken("tk_1");

    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: "HTTP 401",
    });
  });

  it("returns ok=false with the error message when fetch throws", async () => {
    vi.mocked(getScimTokenById).mockResolvedValue(activeRow());
    vi.mocked(decryptScimSecret).mockResolvedValue(PLAINTEXT);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNREFUSED 127.0.0.1:3000")
    );

    const result = await probeScimToken("tk_1");

    expect(result).toEqual({
      ok: false,
      status: 0,
      reason: "ECONNREFUSED 127.0.0.1:3000",
    });
  });

  it("sends Authorization Bearer <plaintext> and X-SCIM-Probe: 1 to /scim/v2/ServiceProviderConfig with cache: no-store", async () => {
    vi.mocked(getScimTokenById).mockResolvedValue(activeRow());
    vi.mocked(decryptScimSecret).mockResolvedValue(PLAINTEXT);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await probeScimToken("tk_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      "http://localhost:3000/scim/v2/ServiceProviderConfig"
    );
    expect(calledInit.cache).toBe("no-store");
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${PLAINTEXT}`);
    expect(headers["X-SCIM-Probe"]).toBe("1");
  });
});
