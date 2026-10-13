import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, values?: object) => {
    const base = namespace ? `${namespace}.${key}` : key;
    return values ? `${base}:${JSON.stringify(values)}` : base;
  },
}));

let comboboxProps: any = null;
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: (props: any) => {
    comboboxProps = props;
    return <div data-testid="branch-combobox" />;
  },
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}));
vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: any) => <div>{children}</div>,
  ToggleGroupItem: ({ children, ...rest }: any) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));
vi.mock("../CommitPicker", () => ({
  CommitPicker: () => null,
  commitsUrl: (repositoryId: number, configId: number) =>
    `/api/code-repositories/${repositoryId}/commits?configId=${configId}`,
  toCommitRef: (commit: unknown) => commit,
  useCommitDateFormatter: () => () => "",
}));
vi.mock("../PullRequestPicker", () => ({
  PullRequestPicker: () => null,
}));

import { CommitPickerStep } from "./CommitPickerStep";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const branch = (name: string) => ({
  name,
  sha: `sha-${name}`,
  isDefault: name === "main",
});

function mockBranches(
  branches: ReturnType<typeof branch>[],
  truncated: boolean
) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("/branches?")) {
      const q = new URL(url, "http://localhost").searchParams.get("q");
      return jsonResponse({
        branches: q ? [branch(`remote/${q}`)] : branches,
        defaultBranch: "main",
        configuredBranch: null,
        truncated,
        query: q ?? "",
      });
    }
    if (url.includes("/impact/analyses?"))
      return jsonResponse({ analyses: [] });
    return jsonResponse({}, 404);
  });
}

function renderStep() {
  const onBranchChange = vi.fn();
  render(
    <CommitPickerStep
      projectId={7}
      config={
        {
          id: 5,
          repositoryId: 9,
          branch: null,
          repository: { name: "acme/app", provider: "GITHUB" },
        } as any
      }
      branch={null}
      base={null}
      head={null}
      sameCommit={false}
      onBranchChange={onBranchChange}
      onBaseChange={vi.fn()}
      onHeadChange={vi.fn()}
    />
  );
  return { onBranchChange };
}

describe("CommitPickerStep branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comboboxProps = null;
  });

  it("filters a complete list locally and shows no truncation note", async () => {
    mockBranches(
      [branch("main"), branch("release/1.0"), branch("feature/x")],
      false
    );
    const { onBranchChange } = renderStep();

    await waitFor(() => expect(onBranchChange).toHaveBeenCalledWith("main"));
    expect(screen.queryByTestId("impact-branches-truncated")).toBeNull();

    const before = mockFetch.mock.calls.length;
    const { results } = await comboboxProps.fetchOptions("REL", 0, 30);
    expect(results.map((b: { name: string }) => b.name)).toEqual([
      "release/1.0",
    ]);
    expect(mockFetch.mock.calls.length).toBe(before);
  });

  it("notes a capped list and asks the route to search when the user types", async () => {
    mockBranches([branch("main"), branch("a")], true);
    const { onBranchChange } = renderStep();

    await waitFor(() => expect(onBranchChange).toHaveBeenCalledWith("main"));
    expect(screen.getByTestId("impact-branches-truncated")).toHaveTextContent(
      '{"count":2}'
    );

    const { results } = await comboboxProps.fetchOptions("release", 0, 30);
    const searchCall = mockFetch.mock.calls.find(([url]) =>
      String(url).includes("q=release")
    );
    expect(searchCall).toBeDefined();
    expect(String(searchCall![0])).toContain(
      "/api/code-repositories/9/branches?configId=5&q=release"
    );
    expect(results.map((b: { name: string }) => b.name)).toEqual([
      "remote/release",
    ]);

    // An empty query still comes from the loaded list.
    const all = await comboboxProps.fetchOptions("", 0, 30);
    expect(all.results).toHaveLength(2);
  });

  it("falls back to the configured branch and shows an alert when listing fails", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes("/branches?")
        ? jsonResponse({ error: "boom" }, 502)
        : jsonResponse({ analyses: [] })
    );
    const onBranchChange = vi.fn();
    render(
      <CommitPickerStep
        projectId={7}
        config={
          {
            id: 5,
            repositoryId: 9,
            branch: "develop",
            repository: { name: "acme/app", provider: "GITHUB" },
          } as any
        }
        branch={null}
        base={null}
        head={null}
        sameCommit={false}
        onBranchChange={onBranchChange}
        onBaseChange={vi.fn()}
        onHeadChange={vi.fn()}
      />
    );

    await waitFor(() => expect(onBranchChange).toHaveBeenCalledWith("develop"));
    expect(
      screen.getByText("runs.impact.errors.branchesFailed")
    ).toBeInTheDocument();
  });
});
