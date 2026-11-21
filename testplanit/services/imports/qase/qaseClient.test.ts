import { describe, expect, it, vi } from "vitest";
import {
  normalizeQaseHost,
  parseRateLimit,
  QaseApiError,
  QaseClient,
} from "./qaseClient";

const json = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });

const page = (entities: unknown[], total: number) =>
  json({ status: true, result: { total, filtered: total, entities } });

function makeClient(fetchImpl: typeof fetch, host?: string) {
  const sleep = vi.fn(async () => {});
  const client = new QaseClient({
    token: "secret-token",
    host,
    fetchImpl,
    sleep,
    lookup: async () => ["93.184.216.34"],
  });
  return { client, sleep };
}

describe("normalizeQaseHost", () => {
  it("defaults to Qase's public API host", () => {
    expect(normalizeQaseHost(undefined)).toBe("api.qase.io");
    expect(normalizeQaseHost("  ")).toBe("api.qase.io");
  });

  it("accepts a bare host or an https URL and drops the path", () => {
    expect(normalizeQaseHost("api.qase.example.com")).toBe(
      "api.qase.example.com"
    );
    expect(normalizeQaseHost("https://qase.example.com:8443/v1/")).toBe(
      "qase.example.com:8443"
    );
  });

  it("rejects http and hosts with credentials", () => {
    expect(() => normalizeQaseHost("http://api.qase.io")).toThrow(QaseApiError);
    expect(() => normalizeQaseHost("https://user:pw@api.qase.io")).toThrow(
      QaseApiError
    );
  });
});

describe("parseRateLimit", () => {
  it("returns the policy with the fewest requests left", () => {
    expect(parseRateLimit('"rpm";r=596;t=36, "burst";r=99;t=1')).toEqual({
      remaining: 99,
      resetSeconds: 1,
    });
  });

  it("returns null without a usable header", () => {
    expect(parseRateLimit(null)).toBeNull();
    expect(parseRateLimit("nonsense")).toBeNull();
  });
});

describe("QaseClient", () => {
  it("sends the token header and returns the result", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ status: true, result: { code: "DEMO" } })
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.get("project/DEMO")).resolves.toEqual({ code: "DEMO" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(String(url)).toBe("https://api.qase.io/v1/project/DEMO");
    expect((init.headers as Record<string, string>).Token).toBe("secret-token");
  });

  it("walks every page 100 records at a time", async () => {
    const first = Array.from({ length: 100 }, (_, id) => ({ id }));
    const second = [{ id: 100 }, { id: 101 }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page(first, 102))
      .mockResolvedValueOnce(page(second, 102));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const seen: number[] = [];
    for await (const result of client.pages<{ id: number }>("case/DEMO", {
      include: "external_issues",
    })) {
      seen.push(...result.entities.map((entity) => entity.id));
    }

    expect(seen).toHaveLength(102);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondUrl = fetchImpl.mock.calls[1][0] as URL;
    expect(secondUrl.searchParams.get("offset")).toBe("100");
    expect(secondUrl.searchParams.get("limit")).toBe("100");
    expect(secondUrl.searchParams.get("include")).toBe("external_issues");
  });

  it("waits for Retry-After on a 429 and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({}, { status: 429, headers: { "retry-after": "7" } })
      )
      .mockResolvedValueOnce(json({ status: true, result: [] }));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.get("system_field")).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("pauses before the next request when the burst allowance is used up", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          { status: true, result: 1 },
          { headers: { ratelimit: '"rpm";r=500;t=30, "burst";r=0;t=4' } }
        )
      )
      .mockResolvedValueOnce(json({ status: true, result: 2 }));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await client.get("user");
    expect(sleep).not.toHaveBeenCalled();
    await client.get("user");
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("retries a server error and gives up after five attempts", async () => {
    const fetchImpl = vi.fn(async () => json({}, { status: 503 }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.get("user")).rejects.toMatchObject({
      code: "request_failed",
      status: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("reports a rejected token without retrying", async () => {
    const fetchImpl = vi.fn(async () => json({}, { status: 401 }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.get("project")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a host that resolves to a private address", async () => {
    const fetchImpl = vi.fn();
    const client = new QaseClient({
      token: "secret-token",
      host: "qase.internal.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async () => ["10.0.0.5"],
    });

    await expect(client.get("project")).rejects.toMatchObject({
      code: "invalid_host",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
