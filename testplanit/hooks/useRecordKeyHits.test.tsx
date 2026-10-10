import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TYPE_TOKENS } from "~/lib/recordKey";
import { useRecordKeyHits } from "./useRecordKeyHits";

const configHolder = vi.hoisted(() => ({ enabled: true }));

vi.mock("~/hooks/useRecordKeyConfig", () => ({
  useRecordKeyConfig: () => ({
    enabled: configHolder.enabled,
    tokens: DEFAULT_TYPE_TOKENS,
    isLoading: false,
    formatKey: () => null,
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const hit = (entityType: string, id: number) => ({
  id,
  entityType,
  score: 0,
  source: { name: `Record ${id}` },
});

describe("useRecordKeyHits", () => {
  beforeEach(() => {
    configHolder.enabled = true;
    global.fetch = vi.fn(async (url: string) => {
      const key = new URL(url, "http://localhost").searchParams.get("key");
      const id = Number(String(key).split("-").pop());
      return {
        ok: true,
        json: async () => ({
          hits: key === "404" ? [] : [hit("repositoryCase", id)],
        }),
      };
    }) as any;
  });

  it("resolves every id or key in an OR / comma separated list", async () => {
    const { result } = renderHook(
      () => useRecordKeyHits("#12 OR WEB-TC-34, 56"),
      { wrapper }
    );

    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((h) => h.id)).toEqual([12, 34, 56]);
    const keys = (global.fetch as any).mock.calls.map((call: [string]) =>
      new URL(call[0], "http://localhost").searchParams.get("key")
    );
    // The # prefix is stripped before the lookup
    expect(keys).toEqual(["12", "WEB-TC-34", "56"]);
  });

  it("drops duplicate records when two terms resolve to the same one", async () => {
    const { result } = renderHook(() => useRecordKeyHits("12 OR #12"), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it("does not resolve when any term is not id-shaped", () => {
    const { result } = renderHook(() => useRecordKeyHits("12 OR login"), {
      wrapper,
    });

    expect(result.current).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does nothing while record keys are disabled", () => {
    configHolder.enabled = false;
    const { result } = renderHook(() => useRecordKeyHits("12 OR 34"), {
      wrapper,
    });

    expect(result.current).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
