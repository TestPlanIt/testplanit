import { describe, expect, it } from "vitest";
import {
  apiFetch,
  hasBasePath,
  installBasePathFetch,
  isAbsoluteUrl,
  normalizeBasePath,
  stripBasePath,
  withBasePath,
} from "./basePath";

describe("normalizeBasePath", () => {
  it("treats empty, whitespace and a bare slash as the root", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath(null)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("  ")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
  });

  it("accepts single and nested prefixes", () => {
    expect(normalizeBasePath("/testplanit")).toBe("/testplanit");
    expect(normalizeBasePath("/tools/testplanit")).toBe("/tools/testplanit");
    expect(normalizeBasePath(" /testplanit ")).toBe("/testplanit");
  });

  it("rejects malformed values so the build fails early", () => {
    expect(() => normalizeBasePath("testplanit")).toThrow(/start with/);
    expect(() => normalizeBasePath("/testplanit/")).toThrow(/end with/);
    expect(() => normalizeBasePath("/test planit")).toThrow(/plain path/);
    expect(() => normalizeBasePath("/testplanit?x=1")).toThrow(/plain path/);
    expect(() => normalizeBasePath("/a//b")).toThrow(/plain path/);
  });
});

describe("isAbsoluteUrl", () => {
  it("recognises schemes and protocol-relative URLs", () => {
    expect(isAbsoluteUrl("https://example.com/x")).toBe(true);
    expect(isAbsoluteUrl("mailto:a@b.c")).toBe(true);
    expect(isAbsoluteUrl("//cdn.example.com/x")).toBe(true);
    expect(isAbsoluteUrl("/api/x")).toBe(false);
    expect(isAbsoluteUrl("api/x")).toBe(false);
  });
});

describe("withBasePath", () => {
  it("is the identity at the root", () => {
    expect(withBasePath("/api/model", "")).toBe("/api/model");
    expect(withBasePath("/", "")).toBe("/");
    expect(withBasePath("https://example.com/x", "")).toBe(
      "https://example.com/x"
    );
  });

  it("prefixes root-relative paths once", () => {
    expect(withBasePath("/api/model", "/testplanit")).toBe(
      "/testplanit/api/model"
    );
    expect(withBasePath("/", "/testplanit")).toBe("/testplanit/");
    expect(withBasePath("/en-US/signin?callbackUrl=%2F", "/testplanit")).toBe(
      "/testplanit/en-US/signin?callbackUrl=%2F"
    );
    expect(withBasePath("/api/x", "/tools/testplanit")).toBe(
      "/tools/testplanit/api/x"
    );
  });

  it("leaves already-prefixed paths alone", () => {
    expect(withBasePath("/testplanit/api/model", "/testplanit")).toBe(
      "/testplanit/api/model"
    );
    expect(withBasePath("/testplanit", "/testplanit")).toBe("/testplanit");
    expect(withBasePath("/testplanit?x=1", "/testplanit")).toBe(
      "/testplanit?x=1"
    );
  });

  it("does not mistake a sibling route for the prefix", () => {
    expect(withBasePath("/testplanit-docs/x", "/testplanit")).toBe(
      "/testplanit/testplanit-docs/x"
    );
  });

  it("leaves absolute, protocol-relative and non-rooted strings alone", () => {
    expect(withBasePath("https://example.com/api", "/testplanit")).toBe(
      "https://example.com/api"
    );
    expect(withBasePath("//cdn.example.com/x", "/testplanit")).toBe(
      "//cdn.example.com/x"
    );
    expect(withBasePath("mailto:a@b.c", "/testplanit")).toBe("mailto:a@b.c");
    expect(withBasePath("api/x", "/testplanit")).toBe("api/x");
    expect(withBasePath("?page=2", "/testplanit")).toBe("?page=2");
    expect(withBasePath("", "/testplanit")).toBe("");
  });
});

describe("hasBasePath", () => {
  it("is always true at the root", () => {
    expect(hasBasePath("/anything", "")).toBe(true);
  });

  it("matches the prefix itself and paths under it only", () => {
    expect(hasBasePath("/testplanit", "/testplanit")).toBe(true);
    expect(hasBasePath("/testplanit/api", "/testplanit")).toBe(true);
    expect(hasBasePath("/testplanit?x", "/testplanit")).toBe(true);
    expect(hasBasePath("/testplanit-docs", "/testplanit")).toBe(false);
    expect(hasBasePath("/api", "/testplanit")).toBe(false);
  });
});

describe("stripBasePath", () => {
  it("is the identity at the root", () => {
    expect(stripBasePath("/api/x", "")).toBe("/api/x");
  });

  it("removes the prefix and maps the bare prefix to /", () => {
    expect(stripBasePath("/testplanit/api/x", "/testplanit")).toBe("/api/x");
    expect(stripBasePath("/testplanit", "/testplanit")).toBe("/");
    expect(stripBasePath("/tools/testplanit/en-US", "/tools/testplanit")).toBe(
      "/en-US"
    );
  });

  it("leaves paths outside the prefix unchanged", () => {
    expect(stripBasePath("/api/x", "/testplanit")).toBe("/api/x");
    expect(stripBasePath("/testplanit-docs/x", "/testplanit")).toBe(
      "/testplanit-docs/x"
    );
  });
});

describe("apiFetch", () => {
  it("passes a string input through withBasePath and keeps init", async () => {
    const calls: Array<[unknown, RequestInit | undefined]> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response("ok");
    }) as typeof fetch;
    try {
      // BASE_PATH is "" under test, so the call is unchanged at the root.
      await apiFetch("/api/health", { method: "GET" });
      const request = new Request("https://example.com/api/x");
      await apiFetch(request);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls[0]).toEqual(["/api/health", { method: "GET" }]);
    expect(calls[1]?.[0]).toBeInstanceOf(Request);
  });
});

describe("installBasePathFetch", () => {
  it("is a no-op at the root", () => {
    const original = async () => new Response("ok");
    const target = { fetch: original as unknown as typeof fetch };
    installBasePathFetch(target, "");
    expect(target.fetch).toBe(original);
  });

  it("prefixes root-relative string inputs only, and installs once", async () => {
    const calls: unknown[] = [];
    const target = {
      fetch: (async (input: unknown) => {
        calls.push(input);
        return new Response("ok");
      }) as unknown as typeof fetch,
    };
    installBasePathFetch(target, "/testplanit");
    const installed = target.fetch;
    installBasePathFetch(target, "/testplanit");
    expect(target.fetch).toBe(installed);

    await target.fetch("/api/model/user/findMany");
    await target.fetch("/testplanit/api/x");
    await target.fetch("https://other.test/api");
    const url = new URL("https://example.com/api/y");
    await target.fetch(url);
    const request = new Request("https://example.com/api/z");
    await target.fetch(request);

    expect(calls[0]).toBe("/testplanit/api/model/user/findMany");
    expect(calls[1]).toBe("/testplanit/api/x");
    expect(calls[2]).toBe("https://other.test/api");
    expect(calls[3]).toBe(url);
    expect(calls[4]).toBe(request);
  });
});
