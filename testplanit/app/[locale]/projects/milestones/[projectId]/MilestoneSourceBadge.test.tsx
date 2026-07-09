import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

import { MilestoneSourceBadge } from "./MilestoneSourceBadge";

const synced = {
  integrationId: 9,
  externalKind: "ITERATION",
  externalState: "active",
  externalUrl: "https://jira.example.com/secure/RapidBoard.jspa?rapidView=39&sprint=4053",
};

describe("MilestoneSourceBadge", () => {
  it("renders nothing for local milestones", () => {
    render(
      <MilestoneSourceBadge
        milestone={{ ...synced, integrationId: null }}
      />
    );
    expect(screen.queryByTestId("milestone-source-badge")).toBeNull();
  });

  it("is a link that opens the tracker without an opener when the URL is safe", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MilestoneSourceBadge milestone={synced} />);

    const badge = screen.getByTestId("milestone-source-badge");
    expect(badge).toHaveAttribute("role", "link");
    expect(screen.getByTestId("milestone-open-in-tracker")).toBeInTheDocument();

    fireEvent.click(badge);
    expect(openSpy).toHaveBeenCalledWith(
      synced.externalUrl,
      "_blank",
      "noopener,noreferrer"
    );
    openSpy.mockRestore();
  });

  it("renders a plain, non-clickable badge for unsafe or missing URLs", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MilestoneSourceBadge
        milestone={{ ...synced, externalUrl: "javascript:alert(1)" }}
      />
    );
    const badge = screen.getByTestId("milestone-source-badge");
    expect(badge).not.toHaveAttribute("role", "link");
    expect(screen.queryByTestId("milestone-open-in-tracker")).toBeNull();
    fireEvent.click(badge);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("stops click propagation so card rows don't also navigate", () => {
    const parentClick = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <div onClick={parentClick}>
        <MilestoneSourceBadge milestone={synced} />
      </div>
    );
    fireEvent.click(screen.getByTestId("milestone-source-badge"));
    expect(parentClick).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
