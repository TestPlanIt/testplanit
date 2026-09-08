import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseSession = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));

// Renders the instant as an ISO day so assertions don't depend on the
// viewer's date-format preference.
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => (
    <span>{new Date(date).toISOString().slice(0, 10)}</span>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  // The tooltip duplicates every date; keep it out of the assertions.
  TooltipContent: () => null,
}));

import { DateTextDisplay } from "./DateTextDisplay";

describe("DateTextDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { preferences: { timezone: "Etc/UTC" } } },
    });
  });

  it("renders a start-to-end range across different days", () => {
    render(
      <DateTextDisplay
        startDate={new Date("2026-07-16T10:00:00Z")}
        endDate={new Date("2026-07-22T15:30:00Z")}
      />
    );

    expect(screen.getByText("2026-07-16")).toBeInTheDocument();
    expect(screen.getByText("2026-07-22")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("collapses a range whose ends fall on the same day", () => {
    render(
      <DateTextDisplay
        startDate={new Date("2026-07-16T09:00:00Z")}
        endDate={new Date("2026-07-16T17:45:00Z")}
      />
    );

    expect(screen.getAllByText("2026-07-16")).toHaveLength(1);
    expect(screen.queryByText("-")).not.toBeInTheDocument();
  });

  it("keeps both ends when a range crosses midnight in the viewer's zone", () => {
    render(
      <DateTextDisplay
        startDate={new Date("2026-07-16T23:50:00Z")}
        endDate={new Date("2026-07-17T00:10:00Z")}
      />
    );

    expect(screen.getByText("2026-07-16")).toBeInTheDocument();
    expect(screen.getByText("2026-07-17")).toBeInTheDocument();
  });

  it("still renders the completed date when both dates land on one day", () => {
    // Milestones pass isCompleted with both dates; collapsing there would
    // leave the row with no date at all.
    render(
      <DateTextDisplay
        isCompleted
        startDate={new Date("2026-07-16T09:00:00Z")}
        endDate={new Date("2026-07-16T17:45:00Z")}
      />
    );

    expect(screen.getByText("2026-07-16")).toBeInTheDocument();
    expect(screen.getByText(/common.fields.completed/)).toBeInTheDocument();
  });

  it("prefixes a lone start date with the given label", () => {
    render(
      <DateTextDisplay
        startDate={new Date("2026-07-16T09:00:00Z")}
        startLabel="Started"
      />
    );

    expect(screen.getByText(/Started:/)).toBeInTheDocument();
    expect(screen.getByText("2026-07-16")).toBeInTheDocument();
  });
});
