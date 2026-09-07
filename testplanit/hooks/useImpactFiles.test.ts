import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchImpactFiles,
  filterImpactFiles,
  rankImpactFiles,
  useImpactFiles,
  type ImpactFileEntry,
} from "./useImpactFiles";

const FILES: ImpactFileEntry[] = [
  { path: "lib/legacy-checkout-flow/index.ts", size: 10 },
  { path: "src/checkoutHelpers.ts", size: 20 },
  { path: "src/payments/checkout.ts", size: 30 },
  { path: "src/payments/Checkout.test.ts", size: 40 },
  { path: "docs/README.md", size: 50 },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("rankImpactFiles", () => {
  it("returns the list untouched for an empty query", () => {
    expect(rankImpactFiles(FILES, "")).toBe(FILES);
    expect(rankImpactFiles(FILES, "   ")).toBe(FILES);
  });

  it("ranks an exact file name first, then segment-prefix matches, then other substring hits", () => {
    const ranked = rankImpactFiles(FILES, "checkout").map((f) => f.path);
    expect(ranked).toEqual([
      "src/payments/checkout.ts",
      "src/checkoutHelpers.ts",
      "src/payments/Checkout.test.ts",
      "lib/legacy-checkout-flow/index.ts",
    ]);
  });

  it("matches case-insensitively", () => {
    const ranked = rankImpactFiles(FILES, "README").map((f) => f.path);
    expect(ranked).toEqual(["docs/README.md"]);
    expect(rankImpactFiles(FILES, "readme").map((f) => f.path)).toEqual([
      "docs/README.md",
    ]);
  });

  it("boosts a directory segment that starts with the query", () => {
    const ranked = rankImpactFiles(FILES, "pay").map((f) => f.path);
    expect(ranked[0]).toBe("src/payments/checkout.ts");
    expect(ranked).toHaveLength(2);
  });

  it("returns nothing when no path contains the query", () => {
    expect(rankImpactFiles(FILES, "zzz")).toEqual([]);
  });
});

describe("filterImpactFiles", () => {
  it("pages the ranked list and reports the full total", () => {
    const page0 = filterImpactFiles(FILES, "checkout", 0, 2);
    expect(page0.total).toBe(4);
    expect(page0.results.map((f) => f.path)).toEqual([
      "src/payments/checkout.ts",
      "src/checkoutHelpers.ts",
    ]);

    const page1 = filterImpactFiles(FILES, "checkout", 1, 2);
    expect(page1.results.map((f) => f.path)).toEqual([
      "src/payments/Checkout.test.ts",
      "lib/legacy-checkout-flow/index.ts",
    ]);
  });
});

describe("fetchImpactFiles", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports an empty cache as cacheEmpty rather than an error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(409, { error: "cache_empty", meta: null })
    );

    const data = await fetchImpactFiles(3, 5);

    expect(data.cacheEmpty).toBe(true);
    expect(data.files).toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/code-repositories/3/files?configId=5"
    );
  });

  it("returns the cached list with its metadata", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, {
        files: FILES,
        meta: { fetchedAt: "2026-09-01T12:00:00.000Z", fileCount: 5 },
        truncated: false,
        source: "cache",
      })
    );

    const data = await fetchImpactFiles(3, 5);

    expect(data.cacheEmpty).toBe(false);
    expect(data.source).toBe("cache");
    expect(data.files).toHaveLength(5);
    expect(data.meta?.fileCount).toBe(5);
  });

  it("throws the server message on any other failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(502, { error: "Provider unavailable" })
    );

    await expect(fetchImpactFiles(3, 5)).rejects.toThrow(
      "Provider unavailable"
    );
  });
});

describe("useImpactFiles", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("issues no request while disabled", () => {
    renderHook(
      () => useImpactFiles(7, { repositoryId: 3, configId: 5, enabled: false }),
      { wrapper: createWrapper() }
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("exposes a filter over the fetched list", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, {
        files: FILES,
        meta: { fetchedAt: "2026-09-01T12:00:00.000Z", fileCount: 5 },
        truncated: false,
        source: "cache",
      })
    );

    const { result } = renderHook(
      () => useImpactFiles(7, { repositoryId: 3, configId: 5 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.files).toHaveLength(5));

    const { results, total } = result.current.filter("checkout", 0, 10);
    expect(total).toBe(4);
    expect(results[0].path).toBe("src/payments/checkout.ts");
    expect(result.current.source).toBe("cache");
    expect(result.current.cacheEmpty).toBe(false);
  });

  it("flags cacheEmpty on a 409 without surfacing an error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(409, { error: "cache_empty", meta: null })
    );

    const { result } = renderHook(
      () => useImpactFiles(7, { repositoryId: 3, configId: 5 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.cacheEmpty).toBe(true));

    expect(result.current.error).toBeNull();
    expect(result.current.filter("", 0, 10)).toEqual({
      results: [],
      total: 0,
    });
  });
});
