import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetUsersAccessibleProjects } = vi.hoisted(() => ({
  mockGetUsersAccessibleProjects: vi.fn(),
}));

vi.mock("~/app/actions/getUserAccessibleProjects", () => ({
  getUsersAccessibleProjects: mockGetUsersAccessibleProjects,
}));

import { useAccessibleProjectsForUsers } from "./useAccessibleProjectsForUsers";

const project = (id: number) => ({ id, name: `Project ${id}`, iconUrl: null });

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAccessibleProjectsForUsers", () => {
  it("populates the map for the initial ids", async () => {
    mockGetUsersAccessibleProjects.mockResolvedValue({
      a: [project(1)],
      b: [],
    });

    const { result } = renderHook(() =>
      useAccessibleProjectsForUsers(["a", "b"], "key")
    );

    await waitFor(() => expect(result.current.a).toEqual([project(1)]));
    expect(result.current.b).toEqual([]);
    expect(mockGetUsersAccessibleProjects).toHaveBeenCalledTimes(1);
    expect(mockGetUsersAccessibleProjects).toHaveBeenCalledWith(["a", "b"]);
  });

  it("does not re-fetch or strand rows when the same ids arrive as a new array", async () => {
    // Reproduces the original bug: React Query returns a new-but-equal pages
    // reference, so the id array changes identity while its contents do not.
    mockGetUsersAccessibleProjects.mockResolvedValue({ a: [project(1)] });

    const { result, rerender } = renderHook(
      ({ ids }) => useAccessibleProjectsForUsers(ids, "key"),
      { initialProps: { ids: ["a"] } }
    );

    // New array, identical contents.
    rerender({ ids: ["a"] });

    await waitFor(() => expect(result.current.a).toEqual([project(1)]));
    expect(mockGetUsersAccessibleProjects).toHaveBeenCalledTimes(1);
  });

  it("fetches only the newly appended ids as pages grow", async () => {
    mockGetUsersAccessibleProjects
      .mockResolvedValueOnce({ a: [project(1)] })
      .mockResolvedValueOnce({ b: [project(2)] });

    const { result, rerender } = renderHook(
      ({ ids }) => useAccessibleProjectsForUsers(ids, "key"),
      { initialProps: { ids: ["a"] } }
    );

    await waitFor(() => expect(result.current.a).toBeDefined());

    rerender({ ids: ["a", "b"] });

    await waitFor(() => expect(result.current.b).toEqual([project(2)]));
    expect(mockGetUsersAccessibleProjects).toHaveBeenCalledTimes(2);
    expect(mockGetUsersAccessibleProjects).toHaveBeenNthCalledWith(2, ["b"]);
    // First page's data is retained.
    expect(result.current.a).toEqual([project(1)]);
  });

  it("clears and refetches when the resetKey changes", async () => {
    mockGetUsersAccessibleProjects
      .mockResolvedValueOnce({ a: [project(1)] })
      .mockResolvedValueOnce({ c: [project(3)] });

    const { result, rerender } = renderHook(
      ({ ids, key }) => useAccessibleProjectsForUsers(ids, key),
      { initialProps: { ids: ["a"], key: "key1" } }
    );

    await waitFor(() => expect(result.current.a).toBeDefined());

    await act(async () => {
      rerender({ ids: ["c"], key: "key2" });
    });

    await waitFor(() => expect(result.current.c).toEqual([project(3)]));
    // Old page's entry is gone after the reset.
    expect(result.current.a).toBeUndefined();
  });
});
