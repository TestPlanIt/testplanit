import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  ssrfSafeFetch,
  isPrivateOrInternalIp,
  getAllowedPrivateHosts,
  SsrfError,
  MAX_PAGE_BYTES,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
} from "./ssrf";

// Mock dns/promises at the module level
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

// Mock https and http modules
vi.mock("node:https", () => ({
  Agent: vi.fn(),
  request: vi.fn(),
}));

vi.mock("node:http", () => ({
  Agent: vi.fn(),
  request: vi.fn(),
}));

import * as dns from "node:dns/promises";
import * as https from "node:https";
import * as http from "node:http";

const mockDnsLookup = vi.mocked(dns.lookup);
const mockHttpsRequest = vi.mocked(https.request);
const mockHttpRequest = vi.mocked(http.request);

/**
 * Creates a mock IncomingMessage that emits data/end events, and a mock
 * ClientRequest that fires the callback and supports error/timeout events.
 */
function setupMockRequest(
  protocol: "https" | "http",
  opts: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | null;
  }
) {
  const { status = 200, headers = { "content-type": "text/html; charset=utf-8" }, body = "Hello" } = opts;

  const mockRes = new EventEmitter() as EventEmitter & {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
  };
  mockRes.statusCode = status;
  mockRes.statusMessage = "OK";
  mockRes.headers = headers;

  const mockReq = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  mockReq.end = vi.fn();
  mockReq.destroy = vi.fn();

  const requestMock = protocol === "https" ? mockHttpsRequest : mockHttpRequest;
  requestMock.mockImplementation((_url: unknown, _opts: unknown, callback: unknown) => {
    // Fire callback asynchronously to simulate real behavior
    process.nextTick(() => {
      (callback as (res: typeof mockRes) => void)(mockRes);
      // Emit body data
      if (body !== null) {
        const encoder = new TextEncoder();
        mockRes.emit("data", Buffer.from(encoder.encode(body)));
      }
      mockRes.emit("end");
    });
    return mockReq as unknown as ReturnType<typeof https.request>;
  });

  return { mockReq, mockRes };
}

/**
 * Sets up a mock request that streams large data in chunks.
 */
function setupLargeStreamRequest(
  protocol: "https" | "http",
  sizeBytes: number
) {
  const mockRes = new EventEmitter() as EventEmitter & {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
  };
  mockRes.statusCode = 200;
  mockRes.statusMessage = "OK";
  mockRes.headers = { "content-type": "text/html" };

  const mockReq = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  mockReq.end = vi.fn();
  mockReq.destroy = vi.fn();

  const requestMock = protocol === "https" ? mockHttpsRequest : mockHttpRequest;
  requestMock.mockImplementation((_url: unknown, _opts: unknown, callback: unknown) => {
    process.nextTick(() => {
      (callback as (res: typeof mockRes) => void)(mockRes);
      // Stream data in 1KB chunks
      const chunkSize = 1024;
      const chunk = Buffer.alloc(chunkSize, 65); // 'A' repeated
      const totalChunks = Math.ceil(sizeBytes / chunkSize);
      for (let i = 0; i < totalChunks; i++) {
        mockRes.emit("data", chunk);
      }
      mockRes.emit("end");
    });
    return mockReq as unknown as ReturnType<typeof https.request>;
  });

  return { mockReq, mockRes };
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

    setupMockRequest("http", {
      status: 200,
      headers: { "content-type": "text/html" },
      body: "Hello",
    });

    await expect(
      ssrfSafeFetch("http://example.com", { allowHttp: true })
    ).resolves.toBeDefined();
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

    // First request returns a redirect
    setupMockRequest("https", {
      status: 302,
      headers: { "content-type": "text/html", location: "https://metadata.internal/" },
      body: null,
    });

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "REDIRECT_PRIVATE_IP"
    );
  });

  it("throws SsrfError with code TOO_MANY_REDIRECTS after more than 5 redirects", async () => {
    const publicIpResult = { address: "93.184.216.34", family: 4 } as never;
    // We need enough DNS lookups for initial + 5 redirects + 1 more
    for (let i = 0; i < 7; i++) {
      mockDnsLookup.mockResolvedValueOnce(publicIpResult);
    }

    // Each call returns a redirect
    let callCount = 0;
    mockHttpsRequest.mockImplementation((_url: unknown, _opts: unknown, callback: unknown) => {
      callCount++;
      const mockRes = new EventEmitter() as EventEmitter & {
        statusCode: number;
        statusMessage: string;
        headers: Record<string, string>;
      };
      mockRes.statusCode = 302;
      mockRes.statusMessage = "Found";
      mockRes.headers = {
        "content-type": "text/html",
        location: `https://example.com/redirect-${callCount}`,
      };

      const mockReq = new EventEmitter() as EventEmitter & {
        end: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
      };
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();

      process.nextTick(() => {
        (callback as (res: typeof mockRes) => void)(mockRes);
        mockRes.emit("end");
      });
      return mockReq as unknown as ReturnType<typeof https.request>;
    });

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "TOO_MANY_REDIRECTS"
    );
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

  it("throws SsrfError with code INVALID_CONTENT_TYPE for application/pdf response", async () => {
    setupMockRequest("https", {
      headers: { "content-type": "application/pdf" },
      body: "PDF content",
    });

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "INVALID_CONTENT_TYPE"
    );
  });

  it("throws SsrfError with code INVALID_CONTENT_TYPE for application/json response", async () => {
    setupMockRequest("https", {
      headers: { "content-type": "application/json" },
      body: '{"key": "value"}',
    });

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "INVALID_CONTENT_TYPE"
    );
  });

  it("does NOT throw for text/html; charset=utf-8 response", async () => {
    setupMockRequest("https", {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><body>Hello</body></html>",
    });

    await expect(ssrfSafeFetch("https://example.com")).resolves.toMatchObject({
      contentType: "text/html; charset=utf-8",
    });
  });

  it("returns body and finalUrl on successful fetch", async () => {
    setupMockRequest("https", {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><body>Test content</body></html>",
    });

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

  it("throws SsrfError with code CONTENT_TOO_LARGE when Content-Length header exceeds 5MB", async () => {
    const oversizeBytes = MAX_PAGE_BYTES + 1;
    setupMockRequest("https", {
      headers: {
        "content-type": "text/html",
        "content-length": String(oversizeBytes),
      },
      body: "Small body",
    });

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "CONTENT_TOO_LARGE"
    );
  });

  it("throws SsrfError with code CONTENT_TOO_LARGE when streaming body exceeds 5MB (no Content-Length)", async () => {
    const oversizeBytes = MAX_PAGE_BYTES + 1024; // 5MB + 1KB
    setupLargeStreamRequest("https", oversizeBytes);

    await expect(ssrfSafeFetch("https://example.com")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "CONTENT_TOO_LARGE"
    );
  });

  it("returns full body for response under 5MB", async () => {
    const smallBody = "A".repeat(1024); // 1KB
    setupMockRequest("https", {
      headers: { "content-type": "text/html" },
      body: smallBody,
    });

    const result = await ssrfSafeFetch("https://example.com");
    expect(result.body).toBe(smallBody);
  });
});

describe("ssrfSafeFetch - agent pinning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsLookup.mockResolvedValue({
      address: "93.184.216.34",
      family: 4,
    } as never);
  });

  it("passes an agent with lookup callback to https.request", async () => {
    setupMockRequest("https", {
      headers: { "content-type": "text/html" },
      body: "Hello",
    });

    await ssrfSafeFetch("https://example.com");

    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockHttpsRequest.mock.calls[0];
    const requestOpts = callArgs[1] as Record<string, unknown>;
    expect(requestOpts).toHaveProperty("agent");
  });
});

describe("getAllowedPrivateHosts", () => {
  it("returns empty set when env var is unset", () => {
    const original = process.env.ALLOWED_PRIVATE_HOSTS;
    delete process.env.ALLOWED_PRIVATE_HOSTS;
    try {
      const hosts = getAllowedPrivateHosts();
      expect(hosts.size).toBe(0);
    } finally {
      process.env.ALLOWED_PRIVATE_HOSTS = original;
    }
  });

  it("parses comma-separated hostnames into a lowercase set", () => {
    const original = process.env.ALLOWED_PRIVATE_HOSTS;
    process.env.ALLOWED_PRIVATE_HOSTS = " Localhost , 192.168.1.100 , ollama.internal ";
    try {
      const hosts = getAllowedPrivateHosts();
      expect(hosts).toEqual(new Set(["localhost", "192.168.1.100", "ollama.internal"]));
    } finally {
      process.env.ALLOWED_PRIVATE_HOSTS = original;
    }
  });

  it("filters out empty entries from trailing commas", () => {
    const original = process.env.ALLOWED_PRIVATE_HOSTS;
    process.env.ALLOWED_PRIVATE_HOSTS = "localhost,,";
    try {
      const hosts = getAllowedPrivateHosts();
      expect(hosts).toEqual(new Set(["localhost"]));
    } finally {
      process.env.ALLOWED_PRIVATE_HOSTS = original;
    }
  });
});

describe("ssrfSafeFetch - ALLOWED_PRIVATE_HOSTS allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a private IP when the hostname is in allowedHosts", async () => {
    mockDnsLookup.mockResolvedValueOnce({
      address: "127.0.0.1",
      family: 4,
    } as never);

    setupMockRequest("https", {
      headers: { "content-type": "text/html" },
      body: "<html>OK</html>",
    });

    const result = await ssrfSafeFetch("https://localhost:11434", {
      allowedHosts: new Set(["localhost"]),
    });
    expect(result.body).toBe("<html>OK</html>");
  });

  it("still blocks a private IP when the hostname is NOT in allowedHosts", async () => {
    mockDnsLookup.mockResolvedValueOnce({
      address: "127.0.0.1",
      family: 4,
    } as never);

    await expect(
      ssrfSafeFetch("https://localhost:11434", {
        allowedHosts: new Set(["other-host"]),
      })
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof SsrfError && err.code === "PRIVATE_IP"
    );
  });

  it("still blocks redirect to private IP when redirect hostname is not in allowedHosts", async () => {
    mockDnsLookup
      .mockResolvedValueOnce({ address: "93.184.216.34", family: 4 } as never)
      .mockResolvedValueOnce({ address: "10.0.0.1", family: 4 } as never);

    setupMockRequest("https", {
      status: 302,
      headers: { "content-type": "text/html", location: "https://internal.corp/" },
      body: null,
    });

    await expect(
      ssrfSafeFetch("https://example.com", {
        allowedHosts: new Set(["example.com"]),
      })
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SsrfError && err.code === "REDIRECT_PRIVATE_IP"
    );
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
