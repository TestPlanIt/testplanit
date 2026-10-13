import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusDisplay from "./StatusDisplay";

describe("StatusDisplay", () => {
  it("renders the dot variant by default", () => {
    const { container } = render(
      <StatusDisplay name="Passed" color="#2A843F" />
    );

    expect(screen.getByText("Passed")).toBeInTheDocument();
    const dot = container.querySelector("div[style]");
    expect(dot).toHaveStyle({ backgroundColor: "#2A843F" });
    expect(container.querySelector("[data-status-surface]")).toBeNull();
  });

  it("falls back to the untested gray when no color is given", () => {
    const { container } = render(<StatusDisplay name="Untested" />);

    const dot = container.querySelector("div[style]");
    expect(dot).toHaveStyle({ backgroundColor: "#B1B2B3" });
  });

  describe("filled variant", () => {
    it("paints the badge and marks it as a status surface", () => {
      const { container } = render(
        <StatusDisplay variant="filled" name="Passed" color="#2A843F" />
      );

      const badge = container.querySelector("[data-status-surface]");
      expect(badge).toHaveTextContent("Passed");
      expect(badge).toHaveStyle({ backgroundColor: "#2A843F" });
      expect(
        (badge as HTMLElement).style.getPropertyValue("--status-surface-fg")
      ).not.toBe("");
    });

    it.each([
      // Same rule on every surface: dark backgrounds keep white text,
      // light ones (the amber Retest, the untested gray) flip to black.
      ["#2A843F", "#ffffff"],
      ["#786AC8", "#ffffff"],
      ["#FFAA00", "#000000"],
      ["#B1B2B3", "#000000"],
    ])("computes the text color for %s", (background, expected) => {
      const { container } = render(
        <StatusDisplay variant="filled" name="Status" color={background} />
      );

      const badge = container.querySelector(
        "[data-status-surface]"
      ) as HTMLElement;
      expect(badge.style.color).toBe(
        expected === "#ffffff" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)"
      );
    });
  });
});
