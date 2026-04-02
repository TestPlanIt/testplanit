import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ssrfSafeFetch,
  isPrivateOrInternalIp,
  SsrfError,
  MAX_PAGE_BYTES,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
} from "./ssrf";

// Mock dns/promises at the module level
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import * as dns from "node:dns/promises";

const mockDnsLookup = vi.mocked(dns.lookup);

// Helper to create a mock Response
function createMockResponse({
  status = 200,
  headers = { "content-type": "text/html; charset=utf-8" },
  body = "Hello, World!",
  location,
}: {
  status?: number;
  headers?: Record<string, string>;
  body?: string | null;
  location?: string;
} = {}): Response {
  const headersObj: Record<string, string> = { ...headers };
  if (location) {
    headersObj["location"] = location;
  }

  const responseHeaders = new Headers(headersObj);

  // Create a proper readable stream for the body
  let bodyInit: BodyInit | null = null;
  if (body !== null) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(body);
    bodyInit = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  return new Response(bodyInit, {
    status,
    headers: responseHeaders,
  });
}

// Helper to create a large streaming response
function createLargeStreamResponse(sizeBytes: number): Response {
  const chunkSize = 1024; // 1KB chunks
  const chunk = new Uint8Array(chunkSize).fill(65); // 'A' repeated
  const totalChunks = Math.ceil(sizeBytes / chunkSize);

  const stream = new ReadableStream({
    start(controller) {
      let sent = 0;
      while (sent < totalChunks) {
        controller.enqueue(chunk);
        sent++;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
  });
}

describe("isPrivateOrInternalIp", () => {
  it("returns true for 127.0.0.1 (IPv4 loopback)", () => {
    expect(isPrivateOrInternalIp("127.0.0.1")).toBe(true);
  });

  it("returns true for 10.0.0.1 (private class A)", () => {
    expect(isPrivateOrInternalIp("10.0.0.1")).toBe(true);
  });

  it("returns true for 192.168.1.1 (private class C)", () => {
    expect(isPrivateOrInternalIp("192.168.1.1")).toBe(true);
  });

  it("returns true for 172.16.0.1 (private class B start)", () => {
    expect(isPrivateOrInternalIp("172.16.0.1")).toBe(true);
  });

  it("returns true for 172.31.255.255 (private class B end)", () => {
    expect(isPrivateOrInternalIp("172.31.255.255")).toBe(true);
  });

  it("returns false for 172.15.0.1 (not in private class B range)", () => {
    expect(isPrivateOrInternalIp("172.15.0.1")).toBe(false);
  });

  it("returns false for 172.32.0.1 (not in private class B range)", () => {
    expect(isPrivateOrInternalIp("172.32.0.1")).toBe(false);
  });

  it("returns true for 169.254.169.254 (cloud metadata)", () => {
    expect(isPrivateOrInternalIp("169.254.169.254")).toBe(true);
  });

  it("returns true for ::1 (IPv6 loopback)", () => {
    expect(isPrivateOrInternalIp("::1")).toBe(true);
  });

  it("returns true for 0.0.0.0 (unspecified address)", () => {
    expect(isPrivateOrInternalIp("0.0.0.0")).toBe(true);
  });

  it("returns false for 8.8.8.8 (public IP)", () => {
    expect(isPrivateOrInternalIp("8.8.8.8")).toBe(false);
  });

  it("returns false for 1.1.1.1 (public IP)", () => {
    expect(isPrivateOrInternalIp("1.1.1.1")).toBe(false);
  });

  it("returns true for fe80::1 (IPv6 link-local)", () => {
    expect(isPrivateOrInternalIp("fe80::1")).toBe(true);
  });

  it("returns true for fc00::1 (IPv6 ULA)", () => {
    expect(isPrivateOrInternalIp("fc00::1")).toBe(true);
  });

  it("returns true for fd00::1 (IPv6 ULA)", () => {
    expect(isPrivateOrInternalIp("fd00::1")).toBe(true);
  });
});

describe("ssrfSafeFetch - protocol checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws SsrfError with code PROTOCOL_NOT_ALLOWED for file:// URLs", async () => {
    await expect(ssrfSafeFetch("file:///etc/passwd")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "PROTOCOL_NOT_ALLOWED"
    );
  });

  it("throws SsrfError with code PROTOCOL_NOT_ALLOWED for ftp:// URLs", async () => {
    await expect(ssrfSafeFetch("ftp://example.com/file")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "PROTOCOL_NOT_ALLOWED"
    );
  });

  it("throws SsrfError with code PROTOCOL_NOT_ALLOWED for http:// without allowHttp", async () => {
    await expect(ssrfSafeFetch("http://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "PROTOCOL_NOT_ALLOWED"
    );
  });

  it("does NOT throw protocol error for http:// when allowHttp is true (with public IP)", async () => {
    mockDnsLookup.mockResolvedValueOnce({
      address: "93.184.216.34",
      family: 4,
    } as never);

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        status: 200,
        headers: { "content-type": "text/html" },
        body: "Hello",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      ssrfSafeFetch("http://example.com", { allowHttp: true })
    ).resolves.toBeDefined();

    vi.unstubAllGlobals();
  });
});

describe("ssrfSafeFetch - private IP blocking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws SsrfError with code PRIVATE_IP when dns.lookup returns 127.0.0.1", async () => {
    mockDnsLookup.mockResolvedValueOnce({
      address: "127.0.0.1",
      family: 4,
    } as never);

    await expect(ssrfSafeFetch("https://evil.example.com")).rejects.toSatisfy(
      (err: unknown) => err instanceof SsrfError && err.code === "PRIVATE_IP"
    );
  });

  it("throws SsrfError with code PRIVATE_IP when dns.lookup returns 10.0.0.1", async () => {
    mockDnsLookup.mockResolvedValueOnce({
      address: "10.0.0.1",
      family: 4,
    } as never);

    await expect(
      ssrfSafeFetch("https://internal.example.com")
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof SsrfError && err.code === "PRIVATE_IP"
    );
  });

  it("throws SsrfError with code PRIVATE_IP when dns.lookup returns 192.168.1.1", async () => {
    mockDnsLookup.mockResolvedValueOnce({
      address: "192.168.1.1",
      family: 4,
    } as never);

    await expect(
      ssrfSafeFetch("https://intranet.example.com")
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof SsrfError && err.code === "PRIVATE_IP"
    );
  });
});

describe("ssrfSafeFetch - redirect handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws SsrfError with code REDIRECT_PRIVATE_IP when redirect goes to private IP", async () => {
    // First DNS lookup for original host — returns public IP
    mockDnsLookup
      .mockResolvedValueOnce({ address: "93.184.216.34", family: 4 } as never)
      // Second DNS lookup for redirect target — returns private IP (cloud metadata)
      .mockResolvedValueOnce({ address: "169.254.169.254", family: 4 } as never);

    const redirectResponse = createMockResponse({
      status: 302,
      headers: { "content-type": "text/html" },
      body: null,
      location: "https://metadata.internal/",
    });

    const mockFetch = vi.fn().mockResolvedValueOnce(redirectResponse);
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "REDIRECT_PRIVATE_IP"
    );

    vi.unstubAllGlobals();
  });

  it("throws SsrfError with code TOO_MANY_REDIRECTS after more than 5 redirects", async () => {
    // Resolve all DNS lookups to a public IP (need enough mocks for initial + 5 redirect hops)
    const publicIpResult = { address: "93.184.216.34", family: 4 } as never;
    // We need 6 DNS lookups (initial + 5 redirects = 6 total requests before TOO_MANY_REDIRECTS)
    for (let i = 0; i < 7; i++) {
      mockDnsLookup.mockResolvedValueOnce(publicIpResult);
    }

    // Each response redirects to the next URL (all go to public destinations)
    const redirectResponse = (n: number) =>
      createMockResponse({
        status: 302,
        headers: { "content-type": "text/html" },
        body: null,
        location: `https://example.com/redirect-${n}`,
      });

    const mockFetch = vi.fn();
    // Set up 6 redirect responses (exceeds MAX_REDIRECTS of 5)
    for (let i = 1; i <= 6; i++) {
      mockFetch.mockResolvedValueOnce(redirectResponse(i));
    }
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "TOO_MANY_REDIRECTS"
    );

    vi.unstubAllGlobals();
  });
});

describe("ssrfSafeFetch - content-type checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsLookup.mockResolvedValue({
      address: "93.184.216.34",
      family: 4,
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws SsrfError with code INVALID_CONTENT_TYPE for application/pdf response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        headers: { "content-type": "application/pdf" },
        body: "PDF content",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "INVALID_CONTENT_TYPE"
    );
  });

  it("throws SsrfError with code INVALID_CONTENT_TYPE for application/json response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        headers: { "content-type": "application/json" },
        body: '{"key": "value"}',
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "INVALID_CONTENT_TYPE"
    );
  });

  it("does NOT throw for text/html; charset=utf-8 response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<html><body>Hello</body></html>",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).resolves.toMatchObject({
      contentType: "text/html; charset=utf-8",
    });
  });

  it("returns body and finalUrl on successful fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<html><body>Test content</body></html>",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await ssrfSafeFetch("https://example.com");
    expect(result.body).toBe("<html><body>Test content</body></html>");
    expect(result.finalUrl).toBe("https://example.com");
    expect(result.contentType).toBe("text/html; charset=utf-8");
  });
});

describe("ssrfSafeFetch - size limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsLookup.mockResolvedValue({
      address: "93.184.216.34",
      family: 4,
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws SsrfError with code CONTENT_TOO_LARGE when Content-Length header exceeds 5MB", async () => {
    const oversizeBytes = MAX_PAGE_BYTES + 1;
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        headers: {
          "content-type": "text/html",
          "content-length": String(oversizeBytes),
        },
        body: "Small body",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "CONTENT_TOO_LARGE"
    );
  });

  it("throws SsrfError with code CONTENT_TOO_LARGE when streaming body exceeds 5MB (no Content-Length)", async () => {
    // Create a response that streams more than 5MB
    const oversizeBytes = MAX_PAGE_BYTES + 1024; // 5MB + 1KB
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createLargeStreamResponse(oversizeBytes));
    vi.stubGlobal("fetch", mockFetch);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "CONTENT_TOO_LARGE"
    );
  });

  it("returns full body for response under 5MB", async () => {
    const smallBody = "A".repeat(1024); // 1KB
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockResponse({
        headers: { "content-type": "text/html" },
        body: smallBody,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await ssrfSafeFetch("https://example.com");
    expect(result.body).toBe(smallBody);
  });
});

describe("constants", () => {
  it("MAX_PAGE_BYTES is 5MB", () => {
    expect(MAX_PAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("FETCH_TIMEOUT_MS is 10 seconds", () => {
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it("MAX_REDIRECTS is 5", () => {
    expect(MAX_REDIRECTS).toBe(5);
  });
});
