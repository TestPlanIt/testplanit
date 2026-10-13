import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/execution/http.ts` is the only outbound path for CI dispatch, so these
 * tests pin its three guarantees: the URL is SSRF-checked before anything
 * leaves the process, redirects are refused rather than followed, and the
 * response body is capped.
 *
 * `isSsrfSafe` stays real (it is pure parsing); only the DNS-resolving
 * `assertSsrfSafeResolved` is stubbed so no test touches the network.
 */
vi.mock("~/utils/ssrf", async (orig) => {
  const actual = await orig<typeof import("~/utils/ssrf")>();
  return { ...actual, assertSsrfSafeResolved: vi.fn(async () => undefined) };
});

import { assertSsrfSafeResolved } from "~/utils/ssrf";
import {
  assertOutboundUrlAllowed,
  ciRequest,
  CI_HTTP_TIMEOUT_MS,
  CI_MAX_BODY_BYTES,
  CiRequestError,
} from "./http";

const mockResolved = assertSsrfSafeResolved as unknown as ReturnType<
  typeof vi.fn
>;
const fetchMock = vi.fn();
const originalAllowedHosts = process.env.ALLOWED_PRIVATE_HOSTS;

/** A minimal Response stand-in: `readCapped` only touches `body.getReader()`. */
function streamed(
  status: number,
  chunks: Uint8Array[] | null,
  headers: Record<string, string> = {}
) {
  let i = 0;
  const cancel = vi.fn(async () => undefined);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    cancel,
    body:
      chunks === null
        ? null
        : {
            getReader: () => ({
              read: async () =>
                i < chunks.length
                  ? { done: false, value: chunks[i++] }
                  : { done: true, value: undefined },
              cancel,
            }),
          },
  };
}

function text(body: string, status = 200) {
  return streamed(status, [new TextEncoder().encode(body)]);
}

beforeEach(() => {
  fetchMock.mockReset();
  mockResolved.mockClear();
  mockResolved.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.ALLOWED_PRIVATE_HOSTS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAllowedHosts === undefined) {
    delete process.env.ALLOWED_PRIVATE_HOSTS;
  } else {
    process.env.ALLOWED_PRIVATE_HOSTS = originalAllowedHosts;
  }
});

function blockedBy(url: string) {
  try {
    assertOutboundUrlAllowed(url);
  } catch (err) {
    return err as CiRequestError;
  }
  throw new Error(`expected ${url} to be blocked`);
}

describe("assertOutboundUrlAllowed — scheme", () => {
  it.each([
    "ftp://ci.example.com/hook",
    "file:///etc/passwd",
    "gopher://ci.example.com/",
    "javascript:alert(1)",
  ])("blocks %s", (url) => {
    const err = blockedBy(url);
    expect(err).toBeInstanceOf(CiRequestError);
    expect(err.code).toBe("BLOCKED");
    expect(err.message).toBe("URL must use http or https");
  });

  it("blocks an unparsable URL", () => {
    const err = blockedBy("not a url at all");
    expect(err.code).toBe("BLOCKED");
    expect(err.message).toBe("Invalid URL");
  });

  it("allows plain http as well as https", () => {
    expect(assertOutboundUrlAllowed("http://ci.example.com/hook")).toBe(
      "http://ci.example.com/hook"
    );
    expect(assertOutboundUrlAllowed("https://ci.example.com/hook")).toBe(
      "https://ci.example.com/hook"
    );
  });
});

describe("assertOutboundUrlAllowed — private and link-local hosts", () => {
  it.each([
    "http://127.0.0.1:8080/generic-webhook-trigger/invoke",
    "http://10.0.0.5/hook",
    "http://192.168.1.20/hook",
    "http://172.16.4.4/hook",
    "http://localhost:8080/hook",
    "http://[::1]:8080/hook",
  ])("blocks %s with an ALLOWED_PRIVATE_HOSTS hint", (url) => {
    const err = blockedBy(url);
    expect(err.code).toBe("BLOCKED");
    expect(err.message).toContain("private or internal address");
    expect(err.message).toContain("ALLOWED_PRIVATE_HOSTS");
  });

  it("blocks the cloud metadata link-local address", () => {
    const err = blockedBy("http://169.254.169.254/latest/meta-data/");
    expect(err.code).toBe("BLOCKED");
    expect(err.message).toContain("169.254.169.254");
  });

  it("permits a host the operator allow-listed", () => {
    process.env.ALLOWED_PRIVATE_HOSTS = "127.0.0.1, jenkins.local";
    expect(assertOutboundUrlAllowed("http://127.0.0.1:8080/hook")).toBe(
      "http://127.0.0.1:8080/hook"
    );
  });

  it("matches the allow-list case-insensitively", () => {
    process.env.ALLOWED_PRIVATE_HOSTS = "Jenkins.Local";
    // Hostnames are lower-cased by the URL parser; the allow-list is too.
    expect(assertOutboundUrlAllowed("http://JENKINS.LOCAL/hook")).toBe(
      "http://jenkins.local/hook"
    );
  });

  it("still blocks a private address that is NOT on the allow-list", () => {
    process.env.ALLOWED_PRIVATE_HOSTS = "127.0.0.1";
    expect(blockedBy("http://10.1.2.3/hook").code).toBe("BLOCKED");
  });
});

describe("assertOutboundUrlAllowed — normalisation", () => {
  it("does not add a trailing slash the caller did not type", () => {
    expect(assertOutboundUrlAllowed("https://ci.example.com")).toBe(
      "https://ci.example.com"
    );
  });

  it("keeps a trailing slash the caller did type", () => {
    expect(assertOutboundUrlAllowed("https://ci.example.com/")).toBe(
      "https://ci.example.com/"
    );
  });

  it("preserves path, query and port", () => {
    expect(
      assertOutboundUrlAllowed(
        "https://ci.example.com:8443/generic-webhook-trigger/invoke?token=t"
      )
    ).toBe(
      "https://ci.example.com:8443/generic-webhook-trigger/invoke?token=t"
    );
  });
});

describe("ciRequest — pre-flight", () => {
  it("never calls fetch for a blocked URL", async () => {
    await expect(ciRequest("http://10.0.0.5/hook")).rejects.toMatchObject({
      name: "CiRequestError",
      code: "BLOCKED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-wraps a DNS-rebinding failure as BLOCKED", async () => {
    mockResolved.mockRejectedValue(
      new Error("Resolved IP 10.1.2.3 for host ci.example.com is private")
    );
    await expect(
      ciRequest("https://ci.example.com/hook")
    ).rejects.toMatchObject({
      code: "BLOCKED",
      message: "Resolved IP 10.1.2.3 for host ci.example.com is private",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the normalised URL, not the raw one", async () => {
    fetchMock.mockResolvedValue(text("{}"));
    await ciRequest("https://ci.example.com");
    expect(mockResolved).toHaveBeenCalledWith("https://ci.example.com");
    expect(fetchMock.mock.calls[0][0]).toBe("https://ci.example.com");
  });
});

describe("ciRequest — redirects", () => {
  it.each([301, 302, 303, 307, 308])(
    "turns %i into a REDIRECT error without following it",
    async (status) => {
      fetchMock.mockResolvedValue(
        streamed(status, [], { location: "https://evil.example.com/steal" })
      );
      const err = (await ciRequest("https://ci.example.com/hook", {
        method: "POST",
        body: "{}",
      }).catch((e) => e)) as unknown as CiRequestError;
      expect(err).toBeInstanceOf(CiRequestError);
      expect(err.code).toBe("REDIRECT");
      expect(err.message).toContain(String(status));
      expect(err.message).toContain("redirects are not followed");
      // The POST must reach exactly one host.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("https://ci.example.com/hook");
    }
  );

  it('passes redirect:"manual" so fetch itself never chases the Location', async () => {
    fetchMock.mockResolvedValue(text("ok"));
    await ciRequest("https://ci.example.com/hook", { method: "POST" });
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("treats 2xx and 4xx as ordinary responses", async () => {
    fetchMock.mockResolvedValueOnce(text("nope", 404));
    const res = await ciRequest("https://ci.example.com/hook");
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(res.text).toBe("nope");
  });
});

describe("ciRequest — request shape", () => {
  it("forwards method, headers and body and strips timeoutMs", async () => {
    fetchMock.mockResolvedValue(text("{}"));
    await ciRequest("https://ci.example.com/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
      timeoutMs: 10_000,
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"a":1}');
    expect(init).not.toHaveProperty("timeoutMs");
    expect(init.signal).toBeDefined();
  });

  it("exposes the default timeout and body cap as constants", () => {
    expect(CI_HTTP_TIMEOUT_MS).toBe(15_000);
    expect(CI_MAX_BODY_BYTES).toBe(64 * 1024);
  });
});

describe("ciRequest — transport errors", () => {
  it("maps a DOMException TimeoutError to TIMEOUT", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError")
    );
    await expect(
      ciRequest("https://ci.example.com/hook")
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "The provider did not respond in time",
    });
  });

  it("maps a plain Error named TimeoutError to TIMEOUT", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    fetchMock.mockRejectedValue(err);
    await expect(
      ciRequest("https://ci.example.com/hook")
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps anything else to NETWORK and keeps the cause readable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      ciRequest("https://ci.example.com/hook")
    ).rejects.toMatchObject({
      code: "NETWORK",
      message: "Could not reach the provider: ECONNREFUSED",
    });
  });
});

describe("ciRequest — response body", () => {
  it("truncates the body at CI_MAX_BODY_BYTES", async () => {
    const chunk = new TextEncoder().encode("x".repeat(30_000));
    fetchMock.mockResolvedValue(streamed(200, [chunk, chunk, chunk]));
    const res = await ciRequest("https://ci.example.com/hook");
    expect(res.text.length).toBe(CI_MAX_BODY_BYTES);
    expect(res.json()).toBeNull();
  });

  it("stops reading once the cap is reached", async () => {
    const chunk = new TextEncoder().encode("y".repeat(CI_MAX_BODY_BYTES));
    const reads: number[] = [];
    let i = 0;
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            reads.push(++i);
            return { done: false, value: chunk };
          },
          cancel: async () => undefined,
        }),
      },
    });
    const res = await ciRequest("https://ci.example.com/hook");
    // One read fills the cap; a second would hang on this endless stream.
    expect(reads).toEqual([1]);
    expect(res.text.length).toBe(CI_MAX_BODY_BYTES);
  });

  it("returns an empty string and null json for a bodyless response", async () => {
    fetchMock.mockResolvedValue(streamed(204, null));
    const res = await ciRequest("https://ci.example.com/hook");
    expect(res.text).toBe("");
    expect(res.json()).toBeNull();
    expect(res.status).toBe(204);
  });

  it("parses JSON and exposes the response headers", async () => {
    fetchMock.mockResolvedValue(
      streamed(202, [new TextEncoder().encode('{"externalRunId":12}')], {
        "content-type": "application/json",
      })
    );
    const res = await ciRequest("https://ci.example.com/hook");
    expect(res.json<{ externalRunId: number }>()).toEqual({
      externalRunId: 12,
    });
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("returns null from json() for a non-JSON body", async () => {
    fetchMock.mockResolvedValue(text("<html>nope</html>"));
    const res = await ciRequest("https://ci.example.com/hook");
    expect(res.json()).toBeNull();
    expect(res.text).toBe("<html>nope</html>");
  });
});
