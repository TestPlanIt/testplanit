import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.actions.status": "Status",
      "common.fields.priority": "Priority",
      "issues.issueType": "Issue Type",
      "common.filters.allStatuses": "All Statuses",
      "common.filters.allPriorities": "All Priorities",
      "common.filters.allIssueTypes": "All Issue Types",
      "common.filters.noIssueType": "No Issue Type",
      "common.actions.selectAll": "Select All",
      "common.actions.clearAll": "Clear All",
      "common.labels.noResults": "No Results",
      "common.search": "Search",
    };
    return map[fullKey] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

import type { IssueFacetOptions } from "~/hooks/useIssueFilterOptions";
import type { IssueFacetValue } from "~/lib/issues/issueFacetConditions";
import { IssueListFilters } from "./IssueListFilters";

class MockIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const facet = (
  values: string[],
  overrides: Partial<IssueFacetOptions> = {}
): IssueFacetOptions => ({
  values,
  hasNone: false,
  settled: true,
  ...overrides,
});

const baseProps = {
  statuses: facet(["Done", "Open"]),
  priorities: facet(["High", "Low"]),
  issueTypes: facet(["Bug", "Story"]),
  statusFilter: [] as IssueFacetValue[],
  priorityFilter: [] as IssueFacetValue[],
  issueTypeFilter: [] as IssueFacetValue[],
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onIssueTypeChange: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("IssueListFilters", () => {
  it("renders a facet control per filter, labelled for screen readers", () => {
    render(<IssueListFilters {...baseProps} />);

    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.getByLabelText("Issue Type")).toBeInTheDocument();
    expect(screen.getByText("All Statuses")).toBeInTheDocument();
  });

  it("adds a picked value to the existing selection", async () => {
    const onIssueTypeChange = vi.fn();
    render(
      <IssueListFilters
        {...baseProps}
        issueTypeFilter={["Bug"]}
        onIssueTypeChange={onIssueTypeChange}
      />
    );

    fireEvent.click(screen.getByLabelText("Issue Type"));
    await waitFor(() => {
      expect(screen.getByText("Story")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Story"));

    expect(onIssueTypeChange).toHaveBeenCalledWith(["Bug", "Story"]);
  });

  it("uses the selection as the current value, not just a label", () => {
    render(<IssueListFilters {...baseProps} statusFilter={["Open"]} />);

    const trigger = screen.getByLabelText("Status");
    expect(trigger).toHaveTextContent("Open");
    expect(trigger).not.toHaveTextContent("All Statuses");
  });

  describe("the not-set bucket", () => {
    it("offers No Issue Type when some issues in scope have no type", async () => {
      const onIssueTypeChange = vi.fn();
      render(
        <IssueListFilters
          {...baseProps}
          issueTypes={facet(["Bug", "Story"], { hasNone: true })}
          onIssueTypeChange={onIssueTypeChange}
        />
      );

      fireEvent.click(screen.getByLabelText("Issue Type"));
      await waitFor(() => {
        expect(screen.getByText("No Issue Type")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("No Issue Type"));

      // null, not the label — the label is localized, the query is not.
      expect(onIssueTypeChange).toHaveBeenCalledWith([null]);
    });

    it("withholds No Issue Type when every issue in scope has one", async () => {
      render(<IssueListFilters {...baseProps} />);

      fireEvent.click(screen.getByLabelText("Issue Type"));
      await waitFor(() => {
        expect(screen.getByText("Bug")).toBeInTheDocument();
      });
      expect(screen.queryByText("No Issue Type")).not.toBeInTheDocument();
    });

    it("shows the not-set selection by its label on the trigger", () => {
      render(
        <IssueListFilters
          {...baseProps}
          issueTypes={facet(["Bug"], { hasNone: true })}
          issueTypeFilter={[null]}
        />
      );

      expect(screen.getByLabelText("Issue Type")).toHaveTextContent(
        "No Issue Type"
      );
    });
  });

  describe("facets with nothing to offer", () => {
    it("omits a facet once its query settles with no values", () => {
      render(
        <IssueListFilters
          {...baseProps}
          issueTypes={facet([])}
          statuses={facet([])}
        />
      );

      expect(screen.queryByLabelText("Issue Type")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    });

    it("omits a facet whose only values are blank", () => {
      render(
        <IssueListFilters
          {...baseProps}
          issueTypes={facet([], { hasNone: true })}
        />
      );

      // Every issue untyped: "No Issue Type" would select all of them, so the
      // control would be a no-op.
      expect(screen.queryByLabelText("Issue Type")).not.toBeInTheDocument();
    });

    it("keeps a facet mounted while its query is still in flight", () => {
      render(
        <IssueListFilters
          {...baseProps}
          issueTypes={facet([], { settled: false })}
        />
      );

      // Hiding an unsettled facet would reflow the row when options land.
      expect(screen.getByLabelText("Issue Type")).toBeInTheDocument();
    });
  });
});
