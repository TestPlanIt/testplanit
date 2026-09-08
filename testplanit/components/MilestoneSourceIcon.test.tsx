import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

import { MilestoneSourceIcon } from "./MilestoneSourceIcon";

describe("MilestoneSourceIcon", () => {
  it("renders the tracker glyph with a provider · kind tooltip for a tracked milestone", () => {
    render(
      <MilestoneSourceIcon
        milestone={{
          integrationId: 42,
          externalKind: "ITERATION",
          detachedAt: null,
        }}
      />
    );

    const icon = screen.getByTestId("milestone-source-icon");
    expect(icon).toHaveAttribute("title", "providerJira · kindSprint");
  });

  it("renders nothing for a local milestone (no integrationId)", () => {
    render(<MilestoneSourceIcon milestone={{ integrationId: null }} />);
    expect(screen.queryByTestId("milestone-source-icon")).toBeNull();
  });

  it("renders nothing for a detached (converted-to-local) milestone", () => {
    render(
      <MilestoneSourceIcon
        milestone={{
          integrationId: 42,
          externalKind: "RELEASE",
          detachedAt: new Date("2026-07-01T00:00:00Z"),
        }}
      />
    );
    expect(screen.queryByTestId("milestone-source-icon")).toBeNull();
  });

  it("renders nothing when linkage fields are absent (narrow caller selections)", () => {
    render(<MilestoneSourceIcon milestone={{}} />);
    expect(screen.queryByTestId("milestone-source-icon")).toBeNull();
  });
});
