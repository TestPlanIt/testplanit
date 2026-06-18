/**
 * Phase 14 Wave 0 — Nyquist verification scaffold (RED until the hook ships in 14-03).
 *
 * Pins CTX-03 (client side): useOperationId generates ONE operationId per logical save and a
 * withOperationId(fetch) wrapper attaches it as the X-Operation-Id header on every request in that
 * save; two requests in the same save carry the SAME id; endOperation() clears it.
 *
 * Location: testplanit/hooks/__tests__/ — NOT lib/hooks/ (ZenStack wipes lib/hooks/ on generate).
 *
 * Gating: pure unit suite (testing-library renderHook). The not-yet-existing hook is imported via a
 * runtime-built specifier + /* @vite-ignore *​/ so Vite cannot resolve the missing module at
 * transform time — the suite stays RED (fails on the missing import) rather than failing to load.
 *
 * Implementing plan: 14-03 (testplanit/hooks/useOperationId.ts).
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useOperationIdMod = "~/hooks/useOperationId";

type WrappedFetch = (url: string, options?: RequestInit) => Promise<Response>;
type UseOperationIdReturn = {
  beginOperation: () => string;
  endOperation: () => void;
  withOperationId: (baseFetch?: WrappedFetch) => WrappedFetch;
  operationIdRef: { current: string | null };
};

const loadHook = async (): Promise<() => UseOperationIdReturn> => {
  const mod = (await import(/* @vite-ignore */ useOperationIdMod)) as {
    useOperationId: () => UseOperationIdReturn;
  };
  return mod.useOperationId;
};

// Captures the headers each wrapped-fetch call receives without making a real request.
const makeSpyFetch = () => {
  const headerCalls: Array<string | null> = [];
  const spy = vi.fn(async (_url: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    headerCalls.push(headers.get("X-Operation-Id"));
    return new Response(null, { status: 200 });
  });
  return { spy, headerCalls };
};

describe("useOperationId (CTX-03) — one operationId per save, header attach", () => {
  it("beginOperation() returns a UUID and the wrapped fetch sets X-Operation-Id to it", async () => {
    const useOperationId = await loadHook();
    const { result } = renderHook(() => useOperationId());
    const { spy, headerCalls } = makeSpyFetch();

    let id = "";
    await act(async () => {
      id = result.current.beginOperation();
      const wrapped = result.current.withOperationId(spy);
      await wrapped("/api/model/repositoryCases/update");
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(headerCalls[0]).toBe(id);
  });

  it("two requests in the same save carry the SAME operationId", async () => {
    const useOperationId = await loadHook();
    const { result } = renderHook(() => useOperationId());
    const { spy, headerCalls } = makeSpyFetch();

    await act(async () => {
      result.current.beginOperation();
      const wrapped = result.current.withOperationId(spy);
      await wrapped("/api/model/repositoryCases/update");
      await wrapped("/api/model/caseFieldValues/upsertMany");
    });

    expect(headerCalls).toHaveLength(2);
    expect(headerCalls[0]).toBe(headerCalls[1]);
    expect(headerCalls[0]).not.toBeNull();
  });

  it("endOperation() clears the id so subsequent requests carry no X-Operation-Id", async () => {
    const useOperationId = await loadHook();
    const { result } = renderHook(() => useOperationId());
    const { spy, headerCalls } = makeSpyFetch();

    await act(async () => {
      result.current.beginOperation();
      result.current.endOperation();
      const wrapped = result.current.withOperationId(spy);
      await wrapped("/api/model/repositoryCases/update");
    });

    expect(headerCalls[0]).toBeNull();
  });

  it("delegates to the provided base fetch (falls back to global fetch when omitted)", async () => {
    const useOperationId = await loadHook();
    const { result } = renderHook(() => useOperationId());
    const { spy } = makeSpyFetch();

    await act(async () => {
      result.current.beginOperation();
      const wrapped = result.current.withOperationId(spy);
      await wrapped("/api/model/steps/updateMany", { method: "POST" });
    });

    expect(spy).toHaveBeenCalledWith("/api/model/steps/updateMany", expect.any(Object));
  });
});
