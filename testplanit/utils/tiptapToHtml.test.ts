import { describe, it, expect } from "vitest";
import { tiptapToHtml, isTipTapContent } from "./tiptapToHtml";

describe("tiptapToHtml", () => {
  describe("isTipTapContent", () => {
    it("should return true for valid TipTap JSON", () => {
      const validContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      };

      expect(isTipTapContent(validContent)).toBe(true);
      expect(isTipTapContent(JSON.stringify(validContent))).toBe(true);
    });

    it("should return true for content with content array", () => {
      const contentWithArray = {
        content: [{ type: "paragraph" }],
      };

      expect(isTipTapContent(contentWithArray)).toBe(true);
    });

    it("should return false for invalid content", () => {
      expect(isTipTapContent("plain text")).toBe(false);
      expect(isTipTapContent(null)).toBe(false);
      expect(isTipTapContent(undefined)).toBe(false);
      expect(isTipTapContent({})).toBe(false);
      expect(isTipTapContent({ invalid: "object" })).toBe(false);
    });
  });

  describe("tiptapToHtml", () => {
    it("should convert simple text content to HTML", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain(">Hello world</p>");
      expect(html).toContain('font-family:');
    });

    it("should handle bold and italic text", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Normal " },
              { type: "text", marks: [{ type: "bold" }], text: "bold" },
              { type: "text", text: " and " },
              { type: "text", marks: [{ type: "italic" }], text: "italic" },
            ],
          },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    });

    it("should handle headings", () => {
      const content = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading 1" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading 2" }] },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain(">Heading 1</h1>");
      expect(html).toContain(">Heading 2</h2>");
    });

    it("should handle lists", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Item 1" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Item 2" }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain("ul");
      expect(html).toContain("<li>");
      expect(html).toContain("Item 1");
      expect(html).toContain("Item 2");
    });

    it("should handle links", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://example.com", target: "_blank" },
                  },
                ],
                text: "Click here",
              },
            ],
          },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"'); // cspell:ignore noopener noreferrer
      expect(html).toContain("Click here</a>");
    });

    it("should handle images", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "https://example.com/image.jpg",
              alt: "Test image",
            },
          },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain('<img');
      expect(html).toContain('src="https://example.com/image.jpg"');
      expect(html).toContain('alt="Test image"');
      // Note: Style attributes may vary between TipTap versions
      // The important thing is that the image element is generated correctly
    });

    it("should handle string input by parsing it", () => {
      const content = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "From string" }],
          },
        ],
      });

      const html = tiptapToHtml(content);
      expect(html).toContain(">From string</p>");
    });

    it("should return fallback HTML for invalid content", () => {
      const html = tiptapToHtml("Just plain text");
      expect(html).toBe("<p>Just plain text</p>");
    });

    it("should handle empty content", () => {
      const content = {
        type: "doc",
        content: [],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain("<div");
      expect(html).toContain("</div>");
    });

    it("should handle complex nested content", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Welcome to our " }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", marks: [{ type: "bold" }], text: "Important" },
                      { type: "text", text: " announcement" },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Visit " },
              {
                type: "text",
                marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                text: "our website",
              },
              { type: "text", text: " for more info." },
            ],
          },
        ],
      };

      const html = tiptapToHtml(content);
      expect(html).toContain("Welcome to our");
      expect(html).toContain("<strong>Important</strong>");
      expect(html).toContain("announcement");
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain("our website</a>");
    });
  });
});