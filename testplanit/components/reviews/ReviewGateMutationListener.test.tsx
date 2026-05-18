import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewGateMutationListener } from "./ReviewGateMutationListener";

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const messages: Record<string, string> = {
      "reviews.transitionGate.toastReviewRequired": "Approval required toast.",
      "reviews.transitionGate.toastPendingReviewExists":
        "Pending review toast.",
    };
    const fullKey = namespace ? `${namespace}.${key}` : key;
    return messages[fullKey] ?? fullKey;
  },
}));

function renderWithProviders(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ReviewGateMutationListener />
    </QueryClientProvider>
  );
}

function makeError(code: string | undefined) {
  const e: any = new Error("forced failure");
  e.info = code === undefined ? undefined : { code };
  return e;
}

describe("ReviewGateMutationListener", () => {
  let client: QueryClient;

  beforeEach(() => {
    toastErrorMock.mockClear();
    client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
  });

  afterEach(() => {
    client.clear();
  });

  async function fireMutationWith(error: any) {
    const cache = client.getMutationCache();
    const mutation = cache.build(
      client,
      {
        mutationFn: () => Promise.reject(error),
      },
      undefined
    );
    await act(async () => {
      try {
        await mutation.execute(undefined);
      } catch {
        // Expected — we forced the mutationFn to reject.
      }
    });
  }

  it("(a) shows the REVIEW_REQUIRED toast when a mutation rejects with info.code=REVIEW_REQUIRED", async () => {
    renderWithProviders(client);
    await fireMutationWith(makeError("REVIEW_REQUIRED"));
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("Approval required toast.");
  });

  it("(b) shows the PENDING_REVIEW_EXISTS toast when a mutation rejects with info.code=PENDING_REVIEW_EXISTS", async () => {
    renderWithProviders(client);
    await fireMutationWith(makeError("PENDING_REVIEW_EXISTS"));
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("Pending review toast.");
  });

  it("(c) ignores unrelated mutation errors", async () => {
    renderWithProviders(client);
    await fireMutationWith(makeError("P2002"));
    await fireMutationWith(makeError(undefined));
    await fireMutationWith(new Error("plain"));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("(d) only fires once per failing mutation even if the cache emits multiple update events", async () => {
    renderWithProviders(client);
    await fireMutationWith(makeError("REVIEW_REQUIRED"));
    // The cache emits multiple `updated` events per mutation lifecycle
    // (pending → error, observers added/removed, etc.). The listener dedupes
    // via a WeakSet so the toast surfaces exactly once.
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});
