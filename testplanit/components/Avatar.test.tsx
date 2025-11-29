import { describe, it, expect } from "vitest";
import { Avatar } from "./Avatar";
import { render, screen } from "~/test/test-utils";
import React from "react";

describe("Avatar Component", () => {
  const defaultAlt = "User Name";
  const defaultImage = "/path/to/image.jpg";

  it("should render an image when image prop is provided", () => {
    render(<Avatar image={defaultImage} alt={defaultAlt} />);
    const img = screen.getByRole("img", { name: defaultAlt });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toContain(encodeURIComponent(defaultImage));
  });

  it("should render text fallback when image prop is null", () => {
    render(<Avatar image={null} alt={defaultAlt} />);
    const textElement = screen.getByText(defaultAlt);
    expect(textElement).toBeInTheDocument();
  });

  it("should abbreviate text when width is small (< 50)", () => {
    render(<Avatar image={null} alt={defaultAlt} width={40} height={40} />);
    const abbreviatedText = "UN";
    const textElement = screen.getByText(abbreviatedText);
    expect(textElement).toBeInTheDocument();
    expect(screen.queryByText(defaultAlt)).not.toBeInTheDocument();
  });

  it("should use backgroundColor prop", () => {
    const customBg = "#ff0000";
    render(
      <Avatar image={null} alt={defaultAlt} backgroundColor={customBg} />
    );
    const textElement = screen.getByText(defaultAlt);
    expect(textElement).toHaveStyle({ backgroundColor: customBg });
  });

  it("should apply dynamic font size based on width and height", () => {
    const width = 80;
    const height = 80;
    const averageSize = (width + height) / 2;
    const expectedFontSize = Math.max(12, averageSize / 8).toFixed(0) + "px";

    render(
      <Avatar image={null} alt={defaultAlt} width={width} height={height} />
    );
    const textElement = screen.getByText(defaultAlt);
    expect(textElement).toHaveStyle({ fontSize: expectedFontSize });
  });

  it("should render with a tooltip by default", () => {
    render(<Avatar image={defaultImage} alt={defaultAlt} />);
    const img = screen.getByRole("img");
    expect(img.parentElement?.parentElement?.tagName).toBe("BUTTON");
  });

  it("should render without a tooltip if showTooltip is false", () => {
    render(
      <Avatar image={defaultImage} alt={defaultAlt} showTooltip={false} />
    );
    const img = screen.getByRole("img");
    expect(img.parentElement?.parentElement?.tagName).not.toBe("BUTTON");
  });
});
