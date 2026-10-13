import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseSession } = vi.hoisted(() => ({ mockUseSession: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`;
    t.rich = (key: string, values: Record<string, any>) => (
      <span data-testid={`rich-${key}`}>
        {`${namespace}.${key}`}
        {values.name ? ` name=${values.name}` : ""}
        {values.date?.()}
      </span>
    );
    return t;
  },
}));

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date, formatString, timezone, tooltip }: any) => (
    <span
      data-testid="date-formatter"
      data-date={String(date)}
      data-format={formatString}
      data-timezone={timezone ?? ""}
      data-tooltip={String(tooltip)}
    />
  ),
}));

import { FrozenReportBanner } from "./FrozenReportBanner";

const baseFrozen = {
  capturedAt: "2026-09-20T10:00:00.000Z",
  capturedByName: "Morgan Diaz",
  rowCount: 100,
  totalRowCount: 100,
  truncated: false,
};

describe("FrozenReportBanner", () => {
  beforeEach(() => {
    mockUseSession.mockReset();
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  it("names who captured the report, with the capture date", () => {
    render(<FrozenReportBanner frozen={baseFrozen} />);

    const message = screen.getByTestId("rich-capturedBy");
    expect(message).toHaveTextContent("reports.frozen.capturedBy");
    expect(message).toHaveTextContent("name=Morgan Diaz");
    expect(screen.getByTestId("date-formatter")).toHaveAttribute(
      "data-date",
      baseFrozen.capturedAt
    );
    expect(screen.queryByTestId("rich-capturedAt")).toBeNull();
  });

  it("shows only the capture date when the capturer is unknown", () => {
    render(
      <FrozenReportBanner frozen={{ ...baseFrozen, capturedByName: null }} />
    );

    expect(screen.getByTestId("rich-capturedAt")).toBeInTheDocument();
    expect(screen.queryByTestId("rich-capturedBy")).toBeNull();
    expect(screen.getByTestId("date-formatter")).toBeInTheDocument();
  });

  it("hides the truncated notice when every row was captured", () => {
    render(<FrozenReportBanner frozen={baseFrozen} />);
    expect(screen.queryByTestId("frozen-report-truncated")).toBeNull();
  });

  it("shows the truncated notice with the kept and total row counts", () => {
    render(
      <FrozenReportBanner
        frozen={{
          ...baseFrozen,
          rowCount: 10000,
          totalRowCount: 25000,
          truncated: true,
        }}
      />
    );

    const notice = screen.getByTestId("frozen-report-truncated");
    expect(notice).toHaveTextContent("reports.frozen.truncatedNotice");
    expect(notice).toHaveTextContent('"rowCount":10000');
    expect(notice).toHaveTextContent('"totalRowCount":25000');
  });

  it("formats the date with the signed-in user's preferences", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "u1",
          preferences: {
            dateFormat: "dd/MM/yyyy",
            timeFormat: "hh:mm a",
            timezone: "Europe/Paris",
          },
        },
      },
      status: "authenticated",
    });

    render(<FrozenReportBanner frozen={baseFrozen} />);

    const date = screen.getByTestId("date-formatter");
    expect(date).toHaveAttribute("data-format", "dd/MM/yyyy hh:mm a");
    expect(date).toHaveAttribute("data-timezone", "Europe/Paris");
    expect(date).toHaveAttribute("data-tooltip", "false");
  });

  it("defaults the time part when the user has a date format but no time format", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "u1", preferences: { dateFormat: "yyyy-MM-dd" } } },
      status: "authenticated",
    });

    render(<FrozenReportBanner frozen={baseFrozen} />);
    expect(screen.getByTestId("date-formatter")).toHaveAttribute(
      "data-format",
      "yyyy-MM-dd HH:mm"
    );
  });

  it("falls back to PPp without a session", () => {
    render(<FrozenReportBanner frozen={baseFrozen} />);

    const date = screen.getByTestId("date-formatter");
    expect(date).toHaveAttribute("data-format", "PPp");
    expect(date).toHaveAttribute("data-timezone", "");
  });
});
