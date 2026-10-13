// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Under Node — a worker started with tsx, or the Next server — there is no
// window, so the conversion must take @tiptap/html's server build.
describe("TipTap conversion under Node", () => {
  it("parses HTML with the server build instead of the browser entry", async () => {
    const { convertHtmlToTipTapJSON } = await import("./tiptapConversion");
    expect(typeof window).toBe("undefined");
    const doc = convertHtmlToTipTapJSON(
      "<p>Add <strong>two</strong> items</p>"
    );
    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]).toMatchObject({ type: "paragraph" });
    const bold = doc.content?.[0]?.content?.find((n) =>
      n.marks?.some((m) => m.type === "bold")
    );
    expect(bold?.text).toBe("two");
  });

  it("keeps the text as paragraphs when parsing fails, without recursing", async () => {
    // A browser whose parser throws: the stubbed window routes to the
    // mocked browser entry (the inline require of the server build is out
    // of reach of module mocks).
    vi.resetModules();
    vi.stubGlobal("window", {});
    vi.doMock("@tiptap/html", () => ({
      generateJSON: () => {
        throw new Error("parser unavailable");
      },
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { convertHtmlToTipTapJSON, convertTextToTipTapJSON } =
        await import("./tiptapConversion");
      expect(
        convertHtmlToTipTapJSON("<p>Open the <b>cart</b><br>Check totals</p>")
      ).toEqual({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Open the cart" },
              { type: "hardBreak" },
              { type: "text", text: "Check totals" },
            ],
          },
        ],
      });
      // The text converter goes through the HTML parser too; it must land
      // in the same plain-paragraph fallback rather than overflow the stack.
      expect(convertTextToTipTapJSON("Step one\nStep two")).toMatchObject({
        type: "doc",
      });
      expect(error).toHaveBeenCalled();
    } finally {
      vi.doUnmock("@tiptap/html");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
