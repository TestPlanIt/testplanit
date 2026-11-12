import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useIssueColumns as useAdminIssueColumns } from "~/app/[locale]/admin/issues/columns";
import { useColumns as useAdminTagColumns } from "~/app/[locale]/admin/tags/columns";
import { useIssueColumns } from "~/app/[locale]/issues/columns";
import { useTagColumns } from "~/app/[locale]/tags/columns";
import { CountsLoading, CountsLoadingProvider } from "./CountsLoading";

const tCommon = ((key: string) => key) as never;
const issueTranslations = {
  name: "Name",
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  lastSyncedAt: "Last synced",
  testCases: "Test cases",
  sessions: "Sessions",
  testRuns: "Test runs",
  milestones: "Milestones",
  projects: "Projects",
  integration: "Integration",
};
const tagTranslations = {
  name: "Name",
  testCases: "Test cases",
  sessions: "Sessions",
  testRuns: "Test runs",
  projects: "Projects",
};
const onEdit = () => {};
const onDelete = () => {};

describe("CountsLoading", () => {
  it("hands its child the provider's value", () => {
    const view = (loading: boolean) => (
      <CountsLoadingProvider value={loading}>
        <CountsLoading>
          {(isLoading) => <span>{isLoading ? "loading" : "ready"}</span>}
        </CountsLoading>
      </CountsLoadingProvider>
    );

    const { rerender } = render(view(true));
    expect(screen.getByText("loading")).toBeInTheDocument();

    rerender(view(false));
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("reports not loading when there is no provider", () => {
    render(
      <CountsLoading>
        {(isLoading) => <span>{isLoading ? "loading" : "ready"}</span>}
      </CountsLoading>
    );

    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});

describe("tables whose counts load after their rows", () => {
  const tables: Array<[string, () => unknown]> = [
    [
      "admin issues",
      () =>
        useAdminIssueColumns({
          tCommon,
          onEditIssue: onEdit,
          onDeleteIssue: onDelete,
        }),
    ],
    ["admin tags", () => useAdminTagColumns(tCommon, onEdit, onDelete)],
    ["issues", () => useIssueColumns({ translations: issueTranslations })],
    ["tags", () => useTagColumns(tagTranslations)],
  ];

  it.each(tables)(
    "%s keeps its column definitions while the counts load and arrive",
    (_name, useColumns) => {
      let countsLoading = false;
      const wrapper = ({ children }: { children: ReactNode }) => (
        <CountsLoadingProvider value={countsLoading}>
          {children}
        </CountsLoadingProvider>
      );
      const { result, rerender } = renderHook(useColumns, { wrapper });
      const before = result.current;

      countsLoading = true;
      rerender();
      const whileLoading = result.current;
      countsLoading = false;
      rerender();

      expect(whileLoading).toBe(before);
      expect(result.current).toBe(before);
    }
  );
});
