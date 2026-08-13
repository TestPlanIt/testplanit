import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseSession = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
}));

vi.mock("~/utils/locales", () => ({
  getDateFnsLocale: () => undefined,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip">{children}</div>
  ),
}));

import { DateFormatter } from "./DateFormatter";

describe("DateFormatter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: {
        user: {
          preferences: {
            dateFormat: "MM/dd/yyyy",
            timeFormat: "hh:mm a",
            timezone: "America/Chicago",
          },
        },
      },
    });
  });

  // A Jira release dated 2026-08-13 arrives as the bare string "2026-08-13"
  // and is stored at UTC midnight. The reader here is in GMT-5.
  const jiraReleaseDate = new Date("2026-08-13T00:00:00.000Z");

  it("converts an instant into the viewer's timezone", () => {
    render(
      <DateFormatter
        date={jiraReleaseDate}
        formatString="MM/dd/yyyy"
        timezone="America/Chicago"
      />
    );

    // Correct for a real instant, and precisely the wrong answer for a
    // calendar date — this is the behavior `dateOnly` exists to opt out of.
    expect(screen.getByText("08/12/2026")).toBeInTheDocument();
  });

  it("renders a calendar date as the day it was authored as", () => {
    render(
      <DateFormatter
        date={jiraReleaseDate}
        formatString="MM/dd/yyyy"
        timezone="America/Chicago"
        dateOnly
      />
    );

    // The visible value and the tooltip both carry it, hence getAllByText.
    expect(screen.getAllByText("08/13/2026").length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/08\/12\/2026/)).toHaveLength(0);
  });

  it("renders a calendar date the same way for a viewer east of UTC", () => {
    render(
      <DateFormatter
        date={jiraReleaseDate}
        formatString="MM/dd/yyyy"
        timezone="Asia/Tokyo"
        dateOnly
      />
    );

    expect(screen.getAllByText("08/13/2026").length).toBeGreaterThan(0);
  });

  it("drops the time from a calendar date's tooltip", () => {
    render(
      <DateFormatter
        date={jiraReleaseDate}
        formatString="MM/dd/yyyy"
        timezone="America/Chicago"
        dateOnly
      />
    );

    // A calendar date has no time to reveal, and the one it would show is the
    // storage anchor rather than anything the user set.
    expect(screen.getByTestId("tooltip")).toHaveTextContent(/^08\/13\/2026$/);
  });

  it("still reveals the time in an instant's tooltip", () => {
    render(
      <DateFormatter
        date={new Date("2026-08-13T15:30:00.000Z")}
        formatString="MM/dd/yyyy"
        timezone="America/Chicago"
      />
    );

    expect(screen.getByTestId("tooltip")).toHaveTextContent(
      "08/13/2026 10:30 AM"
    );
  });
});
