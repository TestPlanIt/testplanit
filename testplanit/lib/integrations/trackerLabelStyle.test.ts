import { describe, expect, it } from "vitest";
import { trackerLabelStyle } from "./trackerLabelStyle";

describe("trackerLabelStyle", () => {
  it("outlines in the label colour, tints the fill, and darkens the text on a light theme", () => {
    expect(trackerLabelStyle("0075ca")).toEqual({
      backgroundColor: "rgba(0, 117, 202, 0.1)",
      borderColor: "rgb(0, 117, 202)",
      color: "hsl(205 100% 40%)",
    });
  });

  it("lightens the text on a dark theme", () => {
    expect(trackerLabelStyle("0075ca", true)?.color).toBe("hsl(205 100% 65%)");
    expect(trackerLabelStyle("a2eeef", true)?.color).toBe("hsl(181 71% 79%)");
  });

  it("leaves text lightness alone when it already reads", () => {
    expect(trackerLabelStyle("a2eeef")?.color).toBe("hsl(181 71% 40%)");
    expect(trackerLabelStyle("7057ff", true)?.color).toBe("hsl(249 100% 67%)");
  });

  it("expands a short hex", () => {
    expect(trackerLabelStyle("fff")).toEqual({
      backgroundColor: "rgba(255, 255, 255, 0.1)",
      borderColor: "rgb(255, 255, 255)",
      color: "hsl(0 0% 40%)",
    });
  });

  it("leaves the element unstyled without a usable colour", () => {
    expect(trackerLabelStyle(undefined)).toBeUndefined();
    expect(trackerLabelStyle("")).toBeUndefined();
    expect(trackerLabelStyle("red")).toBeUndefined();
  });
});
