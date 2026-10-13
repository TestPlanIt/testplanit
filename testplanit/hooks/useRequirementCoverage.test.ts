import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invalidateRequirementCoverage,
  isRequirementCoverageQueryKey,
  useRequirementCoverage,
  useRequirementCoverageBreakdown,
} from "./useRequirementCoverage";

describe("isRequirementCoverageQueryKey", () => {
  it("matches this hook's own key for the given project", () => {
    expect(isRequirementCoverageQueryKey(["requirementCoverage", 7], 7)).toBe(
      true
    );
  });

  it("rejects the same key shape for a different project", () => {
    expect(isRequirementCoverageQueryKey(["requirementCoverage", 7], 9)).toBe(
      false
    );
  });

  // F5's whole failure mode was a key that LOOKS like it should match but
  // doesn't -- guard against the inverse mistake here: a predicate written
  // loosely enough (e.g. a `.startsWith`/`.includes` string check) to also
  // catch `useRequirementCoveringCases`' key, which shares a 16-character
  // literal prefix ("requirementCover") with this hook's own root string.
  it("does not match useRequirementCoveringCases' key despite the shared string prefix", () => {
    expect(
      isRequirementCoverageQueryKey(["requirementCoveringCases", 7, 42], 7)
    ).toBe(false);
  });

  it("does not match an unrelated query key", () => {
    expect(isRequirementCoverageQueryKey(["milestoneSummary", 7], 7)).toBe(
      false
    );
    expect(
      isRequirementCoverageQueryKey(["zenstack", "Issue", "findMany", {}], 7)
    ).toBe(false);
  });

  it("rejects a non-array query key", () => {
    expect(
      isRequirementCoverageQueryKey(
        "requirementCoverage" as unknown as readonly unknown[],
        7
      )
    ).toBe(false);
  });
});

describe("invalidateRequirementCoverage", () => {
  it("invalidates using a predicate built from isRequirementCoverageQueryKey", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateRequirementCoverage(queryClient, 7);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(typeof predicate).toBe("function");

    // Matches this project's coverage query...
    expect(predicate({ queryKey: ["requirementCoverage", 7] })).toBe(true);
    // ...but not a different project's coverage query...
    expect(predicate({ queryKey: ["requirementCoverage", 9] })).toBe(false);
    // ...and not the sibling covering-cases query.
    expect(predicate({ queryKey: ["requirementCoveringCases", 7, 42] })).toBe(
      false
    );
  });
});

describe("execution scope transport", () => {
  const longScope = {
    milestoneIds: Array.from({ length: 201 }, (_, i) => i + 1),
    configIds: [4],
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      {
        client: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
      children
    );

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ projectId: 5, coverage: { "42": {} } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useRequirementCoverage keeps a short scope on the GET query string", async () => {
    const { result } = renderHook(
      () => useRequirementCoverage(5, { milestoneIds: [9, 2], configIds: [] }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/5/requirements/coverage?milestoneIds=9%2C2"
    );
  });

  it("useRequirementCoverage sends a scope too long for the URL as a POST body", async () => {
    const { result } = renderHook(() => useRequirementCoverage(5, longScope), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/5/requirements/coverage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(longScope);
  });

  it("useRequirementCoverageBreakdown keeps requirementIds on the URL when the scope moves to the body", async () => {
    const { result } = renderHook(
      () => useRequirementCoverageBreakdown(5, 42, longScope),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/5/requirements/coverage?requirementIds=42");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(longScope);
  });
});
