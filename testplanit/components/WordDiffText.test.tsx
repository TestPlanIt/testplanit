import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WordDiffText } from "./WordDiffText";

const runs = (container: HTMLElement, tag: "del" | "ins") =>
  [...container.querySelectorAll(tag)].map((node) => node.textContent);

describe("WordDiffText", () => {
  const before = "contrast in both light and dark themes.";
  const after = "contrast in the hero section and navigation.";

  it("marks each changed word on its own by default", () => {
    const { container } = render(
      <WordDiffText before={before} after={after} />
    );
    expect(runs(container, "del").length).toBeGreaterThan(1);
    expect(container.textContent).toContain("contrast in ");
  });

  it("joins neighbouring changes when grouped", () => {
    const { container } = render(
      <WordDiffText before={before} after={after} grouped />
    );
    expect(runs(container, "del")).toEqual(["both light and dark themes."]);
    expect(runs(container, "ins")).toEqual([
      "the hero section and navigation.",
    ]);
  });

  it("shows unchanged text plainly", () => {
    const { container } = render(<WordDiffText before="same" after="same" />);
    expect(container.querySelector("del, ins")).toBeNull();
    expect(container.textContent).toBe("same");
  });
});
