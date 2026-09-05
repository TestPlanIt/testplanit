import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Capture what the picker hands the combobox so the fetching and rendering
// contracts can be driven directly, without a popover in the way.
let comboboxProps: any = null;
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: (props: any) => {
    comboboxProps = props;
    return (
      <div data-testid="async-combobox">
        {props.renderTrigger?.({
          value: props.value,
          defaultContent: props.triggerLabel,
        })}
      </div>
    );
  },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-testid="state-select" data-value={value}>
      <button
        type="button"
        data-testid="set-state-merged"
        disabled={disabled}
        onClick={() => onValueChange("merged")}
      />
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-testid={`state-option-${value}`}>{children}</div>
  ),
  SelectTrigger: ({ children, ...rest }: any) => (
    <div {...rest}>{children}</div>
  ),
  SelectValue: () => <span />,
}));

import { PullRequestPicker, pullRequestsUrl } from "./PullRequestPicker";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makePr(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Fix ${number}`,
    state: "open",
    authorName: "ada",
    sourceBranch: `feature-${number}`,
    targetBranch: "main",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function renderPicker(props: Record<string, unknown> = {}) {
  return render(
    <PullRequestPicker
      repositoryId={9}
      configId={5}
      value={null}
      onValueChange={vi.fn()}
      {...props}
    />
  );
}

describe("pullRequestsUrl", () => {
  it("builds the route with state, paging and a one-based page", () => {
    const url = pullRequestsUrl(9, 5, { state: "open", page: 2 });

    expect(url).toContain("/api/code-repositories/9/pull-requests?");
    expect(url).toContain("configId=5");
    expect(url).toContain("state=open");
    expect(url).toContain("page=2");
    expect(url).toContain("perPage=50");
  });

  it("defaults to the first page and omits an absent search term", () => {
    const url = pullRequestsUrl(9, 5, { state: "all" });

    expect(url).toContain("page=1");
    expect(url).not.toContain("search=");
  });

  it("encodes a search term", () => {
    const url = pullRequestsUrl(9, 5, { state: "all", search: "fix/checkout" });

    expect(url).toContain("search=fix%2Fcheckout");
  });
});

describe("PullRequestPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comboboxProps = null;
    mockFetch.mockResolvedValue(
      jsonResponse({ pullRequests: [makePr(1)], hasMore: false })
    );
  });

  it("starts on all states, so nothing is hidden before the user filters", () => {
    renderPicker();

    expect(screen.getByTestId("state-select")).toHaveAttribute(
      "data-value",
      "all"
    );
  });

  it("offers every state as a filter", () => {
    renderPicker();

    for (const state of ["all", "open", "merged", "closed"]) {
      expect(screen.getByTestId(`state-option-${state}`)).toBeInTheDocument();
    }
  });

  it("fetches with the selected state and a one-based page", async () => {
    renderPicker();

    await comboboxProps.fetchOptions("", 0, 50);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("state=all");
    expect(url).toContain("page=1");
  });

  it("passes a trimmed search term, and none at all when it is only spaces", async () => {
    renderPicker();

    await comboboxProps.fetchOptions("  checkout  ", 0, 50);
    expect(mockFetch.mock.calls[0][0]).toContain("search=checkout");

    await comboboxProps.fetchOptions("   ", 0, 50);
    expect(mockFetch.mock.calls[1][0]).not.toContain("search=");
  });

  it("reports a total past the page when the provider says there is more", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ pullRequests: [makePr(1), makePr(2)], hasMore: true })
    );
    renderPicker();

    const result = await comboboxProps.fetchOptions("", 0, 2);

    expect(result.results).toHaveLength(2);
    expect(result.total).toBeGreaterThan(2);
  });

  it("reports an exact total on the last page", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ pullRequests: [makePr(1), makePr(2)], hasMore: false })
    );
    renderPicker();

    const result = await comboboxProps.fetchOptions("", 0, 50);

    expect(result.total).toBe(2);
  });

  it("tells the caller the mode is unsupported on a 501 instead of erroring", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ code: "unsupported" }, 501));
    const onUnsupported = vi.fn();
    renderPicker({ onUnsupported });

    const result = await comboboxProps.fetchOptions("", 0, 50);

    expect(onUnsupported).toHaveBeenCalled();
    expect(result).toEqual({ results: [], total: 0 });
  });

  it("throws on any other failure, so the combobox can show its error state", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "boom" }, 502));
    renderPicker();

    await expect(comboboxProps.fetchOptions("", 0, 50)).rejects.toThrow(
      /pull requests/i
    );
  });

  it("fetches with the new state after the filter changes", async () => {
    renderPicker();

    fireEvent.click(screen.getByTestId("set-state-merged"));
    await waitFor(() =>
      expect(screen.getByTestId("state-select")).toHaveAttribute(
        "data-value",
        "merged"
      )
    );
    await comboboxProps.fetchOptions("", 0, 50);

    expect(mockFetch.mock.calls.at(-1)![0]).toContain("state=merged");
  });

  it("keys each option by its number", () => {
    renderPicker();

    expect(comboboxProps.getOptionValue(makePr(42))).toBe(42);
  });

  it("shows the number, title, author and state on an option", () => {
    renderPicker();

    // Scoped to this render: the state labels also appear in the filter's own
    // option list, which is already on screen.
    const option = within(
      render(<div>{comboboxProps.renderOption(makePr(42))}</div>).container
    );

    expect(option.getByText("#42")).toBeInTheDocument();
    expect(option.getByText("Fix 42")).toBeInTheDocument();
    expect(option.getByText("ada")).toBeInTheDocument();
    expect(option.getByText("runs.impact.pull.stateOpen")).toBeInTheDocument();
  });

  it("labels a merged pull request with its own state", () => {
    renderPicker();

    const option = within(
      render(
        <div>{comboboxProps.renderOption(makePr(42, { state: "merged" }))}</div>
      ).container
    );

    expect(
      option.getByText("runs.impact.pull.stateMerged")
    ).toBeInTheDocument();
  });

  it("omits the author when the provider did not name one", () => {
    renderPicker();

    const option = within(
      render(
        <div>
          {comboboxProps.renderOption(makePr(42, { authorName: undefined }))}
        </div>
      ).container
    );

    expect(option.queryByText("ada")).not.toBeInTheDocument();
  });

  it("shows the selected pull request on the trigger", () => {
    renderPicker({ value: makePr(42) });

    expect(screen.getByTestId("impact-pull-request")).toHaveTextContent(
      "42 Fix 42"
    );
  });

  it("falls back to the placeholder when nothing is selected", () => {
    renderPicker();

    expect(screen.getByTestId("impact-pull-request")).toHaveTextContent(
      "runs.impact.pull.selectPlaceholder"
    );
  });

  it("disables both the filter and the trigger when disabled", () => {
    renderPicker({ disabled: true });

    expect(screen.getByTestId("set-state-merged")).toBeDisabled();
    expect(screen.getByTestId("impact-pull-request")).toBeDisabled();
  });
});
