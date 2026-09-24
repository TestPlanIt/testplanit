import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
  useLocale: () => "en-US",
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "me", preferences: {} } } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@/actions/share-links", () => ({ revokeShareLink: vi.fn() }));
vi.mock("@/components/share/EditShareLinkDialog", () => ({
  EditShareLinkDialog: () => null,
}));
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: string }) => <span>{String(date)}</span>,
}));
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid="user-name-cell">user:{userId}</span>
  ),
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/shares",
}));

const findManyArgs: any[] = [];
const rows = [
  {
    id: "s1",
    shareKey: "k1",
    title: "Weekly report",
    description: null,
    entityType: "REPORT",
    mode: "PUBLIC",
    viewCount: 3,
    notifyOnView: false,
    isRevoked: false,
    expiresAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdById: "u-1",
    project: { name: "Alpha" },
  },
];
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    shareLink: {
      useFindMany: (args: unknown) => {
        findManyArgs.push(args);
        return { data: rows, isLoading: false, refetch: vi.fn() };
      },
      useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
    },
  }),
}));

import { ShareLinkList } from "./ShareLinkList";

describe("ShareLinkList creator column", () => {
  beforeEach(() => {
    findManyArgs.length = 0;
  });

  it("shows who created each link, in both project and admin views", () => {
    const { unmount } = render(<ShareLinkList projectId={7} />);
    expect(screen.getByText("common.fields.createdBy")).toBeInTheDocument();
    expect(screen.getByTestId("user-name-cell")).toHaveTextContent("user:u-1");
    unmount();

    render(<ShareLinkList showProjectColumn />);
    expect(screen.getByText("common.fields.createdBy")).toBeInTheDocument();
    expect(screen.getByTestId("user-name-cell")).toHaveTextContent("user:u-1");
  });

  it("hides the creator column where every link has the same creator", () => {
    render(<ShareLinkList projectId={7} showCreatorColumn={false} />);

    expect(screen.queryByText("common.fields.createdBy")).toBeNull();
    expect(screen.queryByTestId("user-name-cell")).toBeNull();
    expect(screen.getByText("Weekly report")).toBeInTheDocument();
  });

  it("orders by the creator's name when that header is clicked", () => {
    render(<ShareLinkList projectId={7} />);
    expect(findManyArgs.at(-1).orderBy).toEqual({ createdAt: "desc" });

    // The list enables the header column menu, so sorting goes through it.
    const headerCell = screen
      .getByText("common.fields.createdBy")
      .closest("th")!;
    fireEvent.pointerDown(
      within(headerCell).getByRole("button", { name: /columnOptions$/ })
    );
    fireEvent.click(screen.getByText(/sortAsc$/));

    expect(findManyArgs.at(-1).orderBy).toEqual({
      createdBy: { name: "asc" },
    });
  });
});

describe("ShareLinkList data and mode columns", () => {
  const original = rows.map((row) => ({ ...row }));

  function setRows(next: Array<Record<string, unknown>>) {
    rows.length = 0;
    rows.push(...(next as typeof rows));
  }

  function row(overrides: Record<string, unknown>) {
    return { ...original[0], ...overrides };
  }

  afterEach(() => {
    setRows(original);
  });

  it("marks a report link that has a snapshot as frozen", () => {
    setRows([row({ snapshot: { capturedAt: "2026-09-20T10:00:00.000Z" } })]);
    render(<ShareLinkList projectId={7} />);

    expect(screen.getByTestId("share-data-frozen")).toHaveTextContent(
      "reports.frozen.frozen.title"
    );
    expect(screen.queryByTestId("share-data-live")).toBeNull();
  });

  it("marks report and saved-report links without a snapshot as live", () => {
    setRows([
      row({ id: "s1", shareKey: "k1", entityType: "REPORT", snapshot: null }),
      row({
        id: "s2",
        shareKey: "k2",
        title: "Saved one",
        entityType: "SAVED_REPORT",
        snapshot: null,
      }),
    ]);
    render(<ShareLinkList projectId={7} />);

    const live = screen.getAllByTestId("share-data-live");
    expect(live).toHaveLength(2);
    live.forEach((badge) =>
      expect(badge).toHaveTextContent("reports.frozen.live.title")
    );
    expect(screen.queryByTestId("share-data-frozen")).toBeNull();
  });

  it("shows a dash in the data column for other entity types", () => {
    setRows([row({ entityType: "SEARCH", snapshot: null })]);
    render(<ShareLinkList projectId={7} />);

    expect(screen.queryByTestId("share-data-live")).toBeNull();
    expect(screen.queryByTestId("share-data-frozen")).toBeNull();
    const dataHeader = screen.getByText("common.fields.data").closest("th")!;
    const headerCells = Array.from(
      dataHeader.closest("tr")!.querySelectorAll("th")
    );
    const dataIndex = headerCells.indexOf(dataHeader);
    const bodyRow = screen.getByText("Weekly report").closest("tr")!;
    expect(bodyRow.querySelectorAll("td")[dataIndex]).toHaveTextContent(/^-$/);
  });

  it("puts the full mode text in the badge's title", () => {
    setRows([row({ mode: "PASSWORD_PROTECTED" })]);
    render(<ShareLinkList projectId={7} />);

    const badge = screen.getByTitle("PASSWORD PROTECTED");
    expect(badge).toHaveTextContent("PASSWORD PROTECTED");
  });
});
