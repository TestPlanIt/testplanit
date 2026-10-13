import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The panel must not decide for itself which execution is "latest".
 *
 * It used to walk the raw `testRuns` / `junitResults` relations in JSX and
 * pick a winner — a third definition of "latest" that already disagreed with
 * the server's on skipped automated results. Everything below pins the
 * replacement: the server answers, this panel renders that answer.
 */

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The real schema loads here: this panel imports `LinkType` /
// `RepositoryCaseSource` from `~/zenstack/models`, which reads the schema's
// enum values at module scope and throws against a stubbed one.
const mockLinkFindMany = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCaseLink: {
      useFindMany: (...args: any[]) => mockLinkFindMany(...args),
      useUpsert: () => ({ mutateAsync: vi.fn() }),
      useUpdate: () => ({ mutateAsync: vi.fn() }),
    },
  }),
}));

const mockUseLatestTestResults = vi.fn();
vi.mock("~/hooks/useLatestTestResults", () => ({
  useLatestTestResults: (...args: any[]) => mockUseLatestTestResults(...args),
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: any) => <span>{userId}</span>,
}));

vi.mock("./DateFormatter", () => ({
  DateFormatter: ({ date }: any) => <span>{String(date)}</span>,
}));

import LinkedCasesPanel from "./LinkedCasesPanel";

const LINK = {
  id: 1,
  caseAId: 100,
  caseBId: 200,
  type: "DEPENDS_ON",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  isDeleted: false,
  caseA: { id: 100, name: "This case", source: "MANUAL" },
  caseB: { id: 200, name: "Linked case", source: "MANUAL" },
  createdBy: { id: "u1", name: "Ann" },
};

function renderPanel() {
  return render(
    <LinkedCasesPanel
      caseId={100}
      canManageLinks={false}
      projectId={7}
      session={{ user: { id: "u1", preferences: {} } } as any}
    />
  );
}

describe("LinkedCasesPanel — latest result", () => {
  beforeEach(() => {
    mockLinkFindMany.mockReset();
    mockUseLatestTestResults.mockReset();
    mockLinkFindMany.mockReturnValue({ data: [LINK], refetch: vi.fn() });
    mockUseLatestTestResults.mockReturnValue({});
  });

  it("asks the server for the linked cases' results, not its own case", () => {
    renderPanel();

    const [caseIds] = mockUseLatestTestResults.mock.calls[0];
    expect(caseIds).toEqual([200]);
  });

  it("never selects results in the query it runs for the links", () => {
    renderPanel();

    const [args] = mockLinkFindMany.mock.calls[0];
    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain("junitResults");
    expect(serialized).not.toContain("testRuns");
  });

  it("renders the status the server returned", () => {
    mockUseLatestTestResults.mockReturnValue({
      200: [
        {
          resultId: 9,
          testRunId: 55,
          statusName: "Passed",
          statusColor: "#22c55e",
          isSuccess: true,
          isFailure: false,
          executedAt: "2026-02-02T10:00:00.000Z",
        },
      ],
    });

    renderPanel();

    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("links the status to the run the result came from", () => {
    mockUseLatestTestResults.mockReturnValue({
      200: [
        {
          resultId: 9,
          testRunId: 55,
          statusName: "Failed",
          statusColor: "#ef4444",
          isSuccess: false,
          isFailure: true,
          executedAt: "2026-02-02T10:00:00.000Z",
        },
      ],
    });

    const { container } = renderPanel();

    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href")
    );
    expect(hrefs).toContain("/projects/runs/7/55?selectedCase=200");
  });

  it("says not run when the server reports no execution", () => {
    renderPanel();

    expect(
      screen.getByText("requirements.coverage.notRunCell")
    ).toBeInTheDocument();
  });

  it("renders the bare status when the result has no surviving run", () => {
    mockUseLatestTestResults.mockReturnValue({
      200: [
        {
          resultId: 9,
          testRunId: null,
          statusName: "Passed",
          statusColor: "#22c55e",
          isSuccess: true,
          isFailure: false,
          executedAt: "2026-02-02T10:00:00.000Z",
        },
      ],
    });

    const { container } = renderPanel();

    expect(screen.getByText("Passed")).toBeInTheDocument();
    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href")
    );
    expect(hrefs.some((h) => h?.includes("/projects/runs/"))).toBe(false);
  });
});
