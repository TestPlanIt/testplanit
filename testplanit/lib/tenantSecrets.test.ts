import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpsRequestMock = vi.fn();
vi.mock("https", () => ({
  request: (...args: any[]) => httpsRequestMock(...args),
}));

const fsFiles: Record<string, string | Buffer> = {
  "/var/run/secrets/kubernetes.io/serviceaccount/namespace": "testplanit",
  "/var/run/secrets/kubernetes.io/serviceaccount/token": "sa-token-value",
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt":
    Buffer.from("fake-ca-bytes"),
};
// Vitest's ESM resolution for `import { promises as fs } from "fs"` requires
// the mock to expose a default export too, so we return both shapes.
vi.mock("fs", () => {
  const promises = {
    readFile: vi.fn(async (p: string) => {
      if (!(p in fsFiles)) throw new Error(`unexpected readFile: ${p}`);
      return fsFiles[p];
    }),
  };
  return { default: { promises }, promises };
});

import { __internals, getTenantEncryptionKey } from "./tenantSecrets";

const { extractEncryptionKey, resolveSecretName, _resetForTests } = __internals;

// Simulates https.request: invokes the callback with a mock response whose
// body is the stringified JSON we want to return. Response events are
// emitted synchronously inside req.end() so dedupe assertions don't depend
// on microtask/nextTick ordering.
function queueKubeResponse(body: unknown, statusCode = 200) {
  httpsRequestMock.mockImplementationOnce((_opts: any, cb: any) => {
    const res = new EventEmitter() as any;
    res.statusCode = statusCode;
    const req = new EventEmitter() as any;
    req.end = () => {
      cb(res);
      res.emit("data", Buffer.from(JSON.stringify(body)));
      res.emit("end");
    };
    return req;
  });
}

function lastRequestOptions() {
  return httpsRequestMock.mock.calls[httpsRequestMock.mock.calls.length - 1][0];
}

// Encode a pseudo-env file as K8s Secret data.env
function envSecret(tenantKey: string) {
  const env = `# header\nOTHER=val\nENCRYPTION_KEY=${tenantKey}\n`;
  return { data: { env: Buffer.from(env).toString("base64") } };
}

beforeEach(() => {
  _resetForTests();
  httpsRequestMock.mockReset();
  delete process.env.TENANT_SECRETS_CACHE_TTL_MS;
  delete process.env.TENANT_SECRETS_NAMESPACE;
  delete process.env.TENANT_SECRET_NAME_TEMPLATE;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("extractEncryptionKey", () => {
  it("parses a bare value", () => {
    expect(extractEncryptionKey("ENCRYPTION_KEY=abc123")).toBe("abc123");
  });

  it("parses a double-quoted value", () => {
    expect(extractEncryptionKey('ENCRYPTION_KEY="abc 123"')).toBe("abc 123");
  });

  it("parses a single-quoted value", () => {
    expect(extractEncryptionKey("ENCRYPTION_KEY='abc 123'")).toBe("abc 123");
  });

  it("skips comments and blank lines, picks the real line", () => {
    const env = [
      "# header",
      "",
      "OTHER=val",
      "# ENCRYPTION_KEY=fakecomment",
      "ENCRYPTION_KEY=real-value",
    ].join("\n");
    expect(extractEncryptionKey(env)).toBe("real-value");
  });

  it("returns null when no key is present", () => {
    expect(extractEncryptionKey("FOO=bar\nBAZ=qux")).toBeNull();
  });

  it("returns null when key is present but empty", () => {
    expect(extractEncryptionKey("ENCRYPTION_KEY=")).toBeNull();
  });
});

describe("resolveSecretName", () => {
  it("uses the default tpi-<tenant>-env template", () => {
    delete process.env.TENANT_SECRET_NAME_TEMPLATE;
    expect(resolveSecretName("allego")).toBe("tpi-allego-env");
  });

  it("honors TENANT_SECRET_NAME_TEMPLATE override", () => {
    process.env.TENANT_SECRET_NAME_TEMPLATE = "custom-{tenant}-secret";
    try {
      expect(resolveSecretName("demo")).toBe("custom-demo-secret");
    } finally {
      delete process.env.TENANT_SECRET_NAME_TEMPLATE;
    }
  });
});

describe("getTenantEncryptionKey (HTTP + cache)", () => {
  it("calls the K8s API with SA token auth and CA, returns the tenant key", async () => {
    queueKubeResponse(envSecret("secret-for-allego"));

    const key = await getTenantEncryptionKey("allego");

    expect(key).toBe("secret-for-allego");
    const opts = lastRequestOptions();
    expect(opts.method).toBe("GET");
    expect(opts.path).toBe(
      "/api/v1/namespaces/testplanit/secrets/tpi-allego-env"
    );
    expect(opts.headers.Authorization).toBe("Bearer sa-token-value");
    // CA is projected into the request, not the global agent.
    expect(opts.ca).toBeInstanceOf(Buffer);
    expect((opts.ca as Buffer).toString()).toBe("fake-ca-bytes");
  });

  it("serves subsequent reads from cache (single API call)", async () => {
    queueKubeResponse(envSecret("k-1"));

    const a = await getTenantEncryptionKey("allego");
    const b = await getTenantEncryptionKey("allego");

    expect(a).toBe("k-1");
    expect(b).toBe("k-1");
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent cold-cache fetches for the same tenant", async () => {
    queueKubeResponse(envSecret("k-concurrent"));

    const [a, b, c] = await Promise.all([
      getTenantEncryptionKey("allego"),
      getTenantEncryptionKey("allego"),
      getTenantEncryptionKey("allego"),
    ]);

    expect([a, b, c]).toEqual(["k-concurrent", "k-concurrent", "k-concurrent"]);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to individual data.ENCRYPTION_KEY when data.env is absent", async () => {
    queueKubeResponse({
      data: { ENCRYPTION_KEY: Buffer.from("direct-key").toString("base64") },
    });

    expect(await getTenantEncryptionKey("allego")).toBe("direct-key");
  });

  it("throws on non-2xx Kubernetes API responses", async () => {
    queueKubeResponse({ message: "forbidden" }, 403);

    await expect(getTenantEncryptionKey("allego")).rejects.toThrow(
      /Kubernetes API 403/
    );
  });

  it("throws when the Secret has no ENCRYPTION_KEY", async () => {
    queueKubeResponse({
      data: { env: Buffer.from("FOO=bar").toString("base64") },
    });

    await expect(getTenantEncryptionKey("allego")).rejects.toThrow(
      /has no ENCRYPTION_KEY/
    );
  });
});
