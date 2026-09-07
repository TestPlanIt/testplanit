import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CODE_PINS_QUERY_KEY_ROOT,
  CodePinRequestError,
  codePinErrorKey,
  createCodePin,
  invalidateCodePins,
  isCodePinsQueryKey,
  useCodePins,
} from "./useCodePins";

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

const pin = {
  id: 1,
  caseId: 99,
  configId: 5,
  kind: "FILE",
  filePath: "src/app.ts",
  startLine: null,
  endLine: null,
  symbol: null,
  anchorSha: "abc1234",
  source: "MANUAL",
  note: null,
  staleDismissedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: { id: "u1", name: "Tester" },
  staleness: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("isCodePinsQueryKey", () => {
  it("matches this hook's own key for the given case", () => {
    expect(
      isCodePinsQueryKey(
        [CODE_PINS_QUERY_KEY_ROOT, 99, { staleness: true }],
        99
      )
    ).toBe(true);
  });

  it("matches every case when caseId is omitted", () => {
    expect(isCodePinsQueryKey([CODE_PINS_QUERY_KEY_ROOT, 99])).toBe(true);
    expect(isCodePinsQueryKey([CODE_PINS_QUERY_KEY_ROOT, 7])).toBe(true);
  });

  it("rejects the same key shape for a different case", () => {
    expect(isCodePinsQueryKey([CODE_PINS_QUERY_KEY_ROOT, 99], 7)).toBe(false);
  });

  it("does not match unrelated or ZenStack keys", () => {
    expect(isCodePinsQueryKey(["caseLatestExecution", 99], 99)).toBe(false);
    expect(
      isCodePinsQueryKey(["zenstack", "RepositoryCases", "findMany", {}], 99)
    ).toBe(false);
  });

  it("rejects a non-array query key", () => {
    expect(
      isCodePinsQueryKey(
        CODE_PINS_QUERY_KEY_ROOT as unknown as readonly unknown[],
        99
      )
    ).toBe(false);
  });
});

describe("invalidateCodePins", () => {
  it("invalidates using a predicate scoped to the case", () => {
    const invalidateQueries = vi.fn();
    invalidateCodePins({ invalidateQueries } as any, 99);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: [CODE_PINS_QUERY_KEY_ROOT, 99] })).toBe(true);
    expect(predicate({ queryKey: [CODE_PINS_QUERY_KEY_ROOT, 7] })).toBe(false);
    expect(
      predicate({ queryKey: ["zenstack", "RepositoryCases", "findMany"] })
    ).toBe(false);
  });

  it("sweeps every case when caseId is omitted", () => {
    const invalidateQueries = vi.fn();
    invalidateCodePins({ invalidateQueries } as any);

    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: [CODE_PINS_QUERY_KEY_ROOT, 99] })).toBe(true);
    expect(predicate({ queryKey: [CODE_PINS_QUERY_KEY_ROOT, 7] })).toBe(true);
  });
});

describe("createCodePin", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("posts the input as JSON and returns the created pin", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(201, { pin })
    );

    const created = await createCodePin(99, {
      configId: 5,
      kind: "FILE",
      filePath: "src/app.ts",
    });

    expect(created).toEqual(pin);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("/api/repository-cases/99/code-pins");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      configId: 5,
      kind: "FILE",
      filePath: "src/app.ts",
    });
  });

  it("maps a 409 to the duplicate code and carries the existing pin id", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(409, { error: "Pin already exists", id: 42 })
    );

    const error = await createCodePin(99, {
      configId: 5,
      kind: "FILE",
      filePath: "src/app.ts",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CodePinRequestError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("duplicate");
    expect(error.duplicateId).toBe(42);
    expect(error.message).toBe("Pin already exists");
    expect(codePinErrorKey(error)).toBe("duplicate");
  });

  it("surfaces a 422 anchor code and its i18n key", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(422, { error: "File not found", code: "file_not_found" })
    );

    const error = await createCodePin(99, {
      configId: 5,
      kind: "FILE",
      filePath: "missing.ts",
    }).catch((caught) => caught);

    expect(error.code).toBe("file_not_found");
    expect(codePinErrorKey(error)).toBe("errorFileNotFound");
  });

  it("falls back to the generic message when the body is not JSON", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const error = await createCodePin(99, {
      configId: 5,
      kind: "FILE",
      filePath: "src/app.ts",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CodePinRequestError);
    expect(error.message).toBe("Failed to create code pin.");
    expect(error.code).toBeNull();
    expect(codePinErrorKey(error)).toBeNull();
  });

  it("returns no key for an unknown error", () => {
    expect(codePinErrorKey(new Error("boom"))).toBeNull();
  });
});

describe("useCodePins", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/code-pins") || url.includes("/code-pins?")) {
        return jsonResponse(200, { pins: [pin], stalenessError: null });
      }
      if (init?.method === "DELETE") {
        return jsonResponse(200, { ok: true });
      }
      if (url.endsWith("/reanchor")) {
        return jsonResponse(200, { pin });
      }
      if (url.endsWith("/stale-dismissal")) {
        return jsonResponse(200, { dismissedAt: "2026-09-02T00:00:00.000Z" });
      }
      return jsonResponse(404, { error: "Not found" });
    }) as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the case's pins under the exported key root", async () => {
    const queryClient = createClient();
    const { result } = renderHook(() => useCodePins(99), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/repository-cases/99/code-pins",
      undefined
    );
    expect(result.current.stalenessError).toBeNull();
    const cached = queryClient
      .getQueryCache()
      .findAll({ predicate: (q) => isCodePinsQueryKey(q.queryKey, 99) });
    expect(cached).toHaveLength(1);
  });

  it("skips the live staleness check when asked", async () => {
    const { result } = renderHook(() => useCodePins(99, { staleness: false }), {
      wrapper: createWrapper(createClient()),
    });

    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/repository-cases/99/code-pins?staleness=0",
      undefined
    );
  });

  it("issues no request while disabled", () => {
    renderHook(() => useCodePins(99, { enabled: false }), {
      wrapper: createWrapper(createClient()),
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("removes through DELETE and invalidates its own key plus RepositoryCases keys", async () => {
    const queryClient = createClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCodePins(99), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    await act(async () => {
      await result.current.remove(1);
    });

    const deleteCall = (global.fetch as any).mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "DELETE"
    );
    expect(deleteCall[0]).toBe("/api/repository-cases/99/code-pins/1");

    const predicates = invalidateSpy.mock.calls
      .map(([arg]) => (arg as any)?.predicate)
      .filter((predicate) => typeof predicate === "function");
    expect(predicates.length).toBeGreaterThan(0);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: [CODE_PINS_QUERY_KEY_ROOT, 99, {}] })
      )
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ["zenstack", "RepositoryCases", "findMany"] })
      )
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: [CODE_PINS_QUERY_KEY_ROOT, 7, {}] })
      )
    ).toBe(false);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ["zenstack", "Issue", "findMany"] })
      )
    ).toBe(false);
  });

  it("re-anchors through the reanchor route", async () => {
    const { result } = renderHook(() => useCodePins(99), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    await act(async () => {
      await result.current.reanchor(1, { startLine: 3, endLine: 4 });
    });

    const call = (global.fetch as any).mock.calls.find(([url]: [string]) =>
      url.endsWith("/reanchor")
    );
    expect(call[0]).toBe("/api/repository-cases/99/code-pins/1/reanchor");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ startLine: 3, endLine: 4 });
  });

  it("dismisses the stale flag through the server-clock route", async () => {
    const { result } = renderHook(() => useCodePins(99), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    let dismissedAt: string | null = null;
    await act(async () => {
      dismissedAt = await result.current.dismissStale(1);
    });

    expect(dismissedAt).toBe("2026-09-02T00:00:00.000Z");
    const call = (global.fetch as any).mock.calls.find(([url]: [string]) =>
      url.endsWith("/stale-dismissal")
    );
    expect(call[0]).toBe(
      "/api/repository-cases/99/code-pins/1/stale-dismissal"
    );
    expect(call[1].method).toBe("POST");
  });

  it("rejects a managed pin removal with the managed code", async () => {
    (global.fetch as any).mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return jsonResponse(409, {
            error: "Pin is managed by the repository",
            code: "managed",
          });
        }
        return jsonResponse(200, { pins: [pin], stalenessError: null });
      }
    );
    const { result } = renderHook(() => useCodePins(99), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    let error: unknown = null;
    await act(async () => {
      error = await result.current.remove(1).catch((caught) => caught);
    });

    expect(error).toBeInstanceOf(CodePinRequestError);
    expect((error as CodePinRequestError).code).toBe("managed");
    expect(codePinErrorKey(error)).toBe("managedTooltip");
  });
});
