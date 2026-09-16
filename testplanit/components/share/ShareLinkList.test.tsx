import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
