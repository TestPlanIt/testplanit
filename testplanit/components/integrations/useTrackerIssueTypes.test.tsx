import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mappingsState = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  useFindMany: vi.fn(),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    integrationProject: {
      useFindMany: (...args: unknown[]) => {
        mappingsState.useFindMany(...args);
        return { data: mappingsState.data, isLoading: mappingsState.isLoading };
      },
    },
  }),
}));

import {
  isIssueTypeCapable,
  useTrackerIssueTypes,
  useTrackerStatuses,
} from "./useTrackerIssueTypes";

const mapping = (id: string, externalProjectId: string, key: string) => ({
  id,
  externalProjectId,
  externalProjectKey: key,
  externalProjectName: null,
});

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

const mockFetch = vi.fn();

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  mappingsState.data = undefined;
  mappingsState.isLoading = false;
  mappingsState.useFindMany.mockReset();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const urls = () => mockFetch.mock.calls.map((call) => String(call[0]));

describe("useTrackerStatuses", () => {
  it("calls the statuses route once per mapping with the project key, merging by name", async () => {
    mappingsState.data = [
      mapping("m1", "10001", "ALPHA"),
      mapping("m2", "10002", "BETA KEY"),
    ];
    mockFetch.mockImplementation(async (url: string) =>
      url.includes("ALPHA")
        ? okJson({
            statuses: [
              { id: "1", name: "To Do" },
              { id: "2", name: "Done" },
            ],
          })
        : okJson({
            statuses: [
              { id: "3", name: "DONE" },
              { id: "4", name: "Review" },
            ],
          })
    );

    const { result } = renderHook(
      () => useTrackerStatuses(5, { id: 9, provider: "JIRA" }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["To Do", "Done", "Review"]);
    expect(urls().sort()).toEqual([
      "/api/integrations/9/statuses?projectKey=ALPHA",
      "/api/integrations/9/statuses?projectKey=BETA%20KEY",
    ]);
    expect(mappingsState.useFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectIntegration: { integrationId: 9, projectId: 5 },
          isActive: true,
        },
      }),
      { enabled: true }
    );
  });

  it.each(["GITHUB", "GITEA"])(
    "uses externalProjectId for label-mode provider %s",
    async (provider) => {
      mappingsState.data = [mapping("m1", "owner/repo", "repo")];
      mockFetch.mockResolvedValue(
        okJson({ statuses: [{ id: "open", name: "open" }] })
      );

      const { result } = renderHook(
        () => useTrackerStatuses(5, { id: 3, provider }),
        { wrapper: wrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(urls()).toEqual([
        "/api/integrations/3/statuses?projectKey=owner%2Frepo",
      ]);
      expect(result.current.data).toEqual(["open"]);
    }
  );

  it("makes one call without a project key when nothing is mapped", async () => {
    mappingsState.data = [];
    mockFetch.mockResolvedValue(
      okJson({ statuses: [{ id: "1", name: "Open" }, { name: "" }, null] })
    );

    const { result } = renderHook(
      () => useTrackerStatuses(5, { id: 9, provider: "REDMINE" }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(urls()).toEqual(["/api/integrations/9/statuses"]);
    expect(result.current.data).toEqual(["Open"]);
  });

  it("skips non-ok responses and fetch errors", async () => {
    mappingsState.data = [
      mapping("m1", "1", "A"),
      mapping("m2", "2", "B"),
      mapping("m3", "3", "C"),
    ];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("=A")) return { ok: false, status: 500 } as Response;
      if (url.endsWith("=B")) throw new Error("network");
      return okJson({ statuses: [{ id: "1", name: "Open" }] });
    });

    const { result } = renderHook(
      () => useTrackerStatuses(5, { id: 9, provider: "JIRA" }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["Open"]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("is disabled without an integration", async () => {
    const { result } = renderHook(() => useTrackerStatuses(5, null), {
      wrapper: wrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mappingsState.useFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectIntegration: { integrationId: -1, projectId: 5 },
        }),
      }),
      { enabled: false }
    );
  });

  it("waits for mappings to load", async () => {
    mappingsState.isLoading = true;
    const { result } = renderHook(
      () => useTrackerStatuses(5, { id: 9, provider: "JIRA" }),
      { wrapper: wrapper() }
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("useTrackerIssueTypes", () => {
  it("reports capability and label mode by provider", () => {
    expect(isIssueTypeCapable("JIRA")).toBe(true);
    expect(isIssueTypeCapable("SIMPLE_URL")).toBe(false);

    const { result: jira } = renderHook(() =>
      useTrackerIssueTypes(5, { id: 9, provider: "JIRA" })
    );
    expect(jira.current).toMatchObject({ capable: true, labelMode: false });

    const { result: github } = renderHook(() =>
      useTrackerIssueTypes(5, { id: 9, provider: "GITHUB" })
    );
    expect(github.current).toMatchObject({ capable: true, labelMode: true });

    const { result: none } = renderHook(() =>
      useTrackerIssueTypes(5, { id: 9, provider: "SIMPLE_URL" })
    );
    expect(none.current.capable).toBe(false);
    expect(mappingsState.useFindMany).toHaveBeenLastCalledWith(
      expect.anything(),
      { enabled: false }
    );
  });

  it("merges issue types across mappings by id, then searches and pages", async () => {
    mappingsState.data = [mapping("m1", "1", "A"), mapping("m2", "2", "B")];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("=A")) {
        return okJson({
          issueTypes: [
            { id: "1", name: "Bug" },
            { id: "2", name: "Story" },
          ],
        });
      }
      if (url.endsWith("=B")) {
        return okJson({
          issueTypes: [
            { id: "2", name: "Story" },
            { id: "3", name: "Big Epic" },
          ],
        });
      }
      return { ok: false } as Response;
    });

    const { result } = renderHook(() =>
      useTrackerIssueTypes(5, { id: 9, provider: "JIRA" })
    );

    let all: Awaited<ReturnType<typeof result.current.fetchIssueTypes>>;
    await act(async () => {
      all = await result.current.fetchIssueTypes("", 0, 10);
    });
    expect(all!.total).toBe(3);
    expect(all!.results.map((t) => t.id).sort()).toEqual(["1", "2", "3"]);
    expect(urls().sort()).toEqual([
      "/api/integrations/9/issue-types?projectKey=A",
      "/api/integrations/9/issue-types?projectKey=B",
    ]);

    const searched = await result.current.fetchIssueTypes("b", 0, 10);
    expect(searched.total).toBe(2);
    expect(searched.results.map((t) => t.name).sort()).toEqual([
      "Big Epic",
      "Bug",
    ]);

    const page1 = await result.current.fetchIssueTypes("", 1, 2);
    expect(page1.total).toBe(3);
    expect(page1.results).toHaveLength(1);
  });

  it("skips failing mappings and returns empty without an integration", async () => {
    mappingsState.data = [mapping("m1", "1", "A"), mapping("m2", "2", "B")];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("=A")) throw new Error("network");
      return okJson({ issueTypes: [{ id: "1", name: "Bug" }] });
    });

    const { result } = renderHook(() =>
      useTrackerIssueTypes(5, { id: 9, provider: "JIRA" })
    );
    expect(await result.current.fetchIssueTypes("", 0, 10)).toEqual({
      results: [{ id: "1", name: "Bug" }],
      total: 1,
    });

    mockFetch.mockClear();
    const { result: none } = renderHook(() => useTrackerIssueTypes(5, null));
    expect(await none.current.fetchIssueTypes("", 0, 10)).toEqual({
      results: [],
      total: 0,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
