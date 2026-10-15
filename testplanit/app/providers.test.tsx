import { useMutation, useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTesting, isUpdateBannerVisible } from "~/lib/deploymentSkew";

vi.mock("next-auth/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/react")>()),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import Providers from "./providers";

const staleAction = () =>
  Object.assign(new Error('Server Action "abc" was not found on the server.'), {
    name: "UnrecognizedActionError",
  });

const staleQueryFn = vi.fn(async () => {
  throw staleAction();
});

function FailingQuery() {
  useQuery({ queryKey: ["providers-test-stale"], queryFn: staleQueryFn });
  return null;
}

function FailingMutation() {
  const { mutate } = useMutation({
    mutationFn: async () => {
      throw staleAction();
    },
  });
  useEffect(() => mutate(), [mutate]);
  return null;
}

describe("Providers QueryClient", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("reports a stale server action from a failed query without retrying it", async () => {
    render(
      <Providers>
        <FailingQuery />
      </Providers>
    );
    // The default retry backoff starts at 1s, past waitFor's 1s timeout.
    await waitFor(() => expect(isUpdateBannerVisible()).toBe(true));
    expect(staleQueryFn).toHaveBeenCalledTimes(1);
  });

  it("reports a stale server action from a failed mutation", async () => {
    render(
      <Providers>
        <FailingMutation />
      </Providers>
    );
    await waitFor(() => expect(isUpdateBannerVisible()).toBe(true));
  });

  it("leaves ordinary query failures alone", async () => {
    const queryFailed = vi.fn();
    function Probe() {
      const { isError } = useQuery({
        queryKey: ["providers-test-ordinary"],
        queryFn: async () => {
          throw new Error("Project not found");
        },
        retry: false,
      });
      if (isError) queryFailed();
      return null;
    }
    render(
      <Providers>
        <Probe />
      </Providers>
    );
    await waitFor(() => expect(queryFailed).toHaveBeenCalled());
    expect(isUpdateBannerVisible()).toBe(false);
  });
});
