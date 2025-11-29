import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import UserWorkGanttChart from "./UserWorkGanttChart";

// Mock Plot.plot to avoid actual SVG rendering
vi.mock("@observablehq/plot", () => ({
  plot: () => document.createElement("svg"),
}));

describe("UserWorkGanttChart", () => {
  const locale = "en";

  it("renders without crashing and shows no tasks message if empty", () => {
    render(<UserWorkGanttChart tasks={[]} locale={locale} />);
    // The translation key is rendered, so match by textContent
    expect(
      screen.getByText((content) => content.toLowerCase().includes("notasks"))
    ).toBeInTheDocument();
  });

  // Tooltip/business hours logic is not testable with the current Plot.plot mock.
  // Consider adding an e2e test for this in the future.
});
