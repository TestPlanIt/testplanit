import { describe, it, expect } from "vitest";
import {
  convertHtmlToTipTapJSON,
  convertTextToTipTapJSON,
  ensureTipTapJSON,
  serializeTipTapJSON,
} from "./tiptapConversion";

describe("convertTextToTipTapJSON", () => {
  it("should convert simple text to TipTap JSON doc", () => {
    const result = convertTextToTipTapJSON("Hello World");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
    expect(result.content!.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle multiline text", () => {
    const result = convertTextToTipTapJSON("Line 1\n\nLine 2");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle empty text by returning empty doc", () => {
    const result = convertTextToTipTapJSON("");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle text with only whitespace", () => {
    const result = convertTextToTipTapJSON("   ");

    expect(result.type).toBe("doc");
  });
});

describe("convertHtmlToTipTapJSON", () => {
  it("should convert simple HTML to TipTap JSON", () => {
    const result = convertHtmlToTipTapJSON("<p>Hello World</p>");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle empty HTML", () => {
    const result = convertHtmlToTipTapJSON("");

    expect(result.type).toBe("doc");
  });

  it("should handle HTML with bold text", () => {
    const result = convertHtmlToTipTapJSON("<p><strong>Bold</strong></p>");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle HTML with lists", () => {
    const result = convertHtmlToTipTapJSON(
      "<ul><li>Item 1</li><li>Item 2</li></ul>"
    );

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });
});

describe("ensureTipTapJSON", () => {
  it("should return valid TipTap JSON unchanged", () => {
    const validJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };

    const result = ensureTipTapJSON(validJSON);

    expect(result).toEqual(validJSON);
  });

  it("should convert plain text to TipTap JSON", () => {
    const result = ensureTipTapJSON("Plain text");

    expect(result.type).toBe("doc");
    expect(result.content![0].type).toBe("paragraph");
    // The text content structure may vary based on TipTap's generateJSON
    expect(result.content).toBeDefined();
  });

  it("should convert JSON string to TipTap JSON", () => {
    const jsonString = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "From string" }] },
      ],
    });

    const result = ensureTipTapJSON(jsonString);

    expect(result.type).toBe("doc");
    expect(result.content![0].content![0].text).toBe("From string");
  });

  it("should handle null/undefined", () => {
    const resultNull = ensureTipTapJSON(null);
    const resultUndefined = ensureTipTapJSON(undefined);

    expect(resultNull.type).toBe("doc");
    expect(resultUndefined.type).toBe("doc");
  });

  it("should handle empty object", () => {
    const result = ensureTipTapJSON({});

    expect(result.type).toBe("doc");
  });

  it("should handle object with type but no content", () => {
    const result = ensureTipTapJSON({ type: "doc" });

    expect(result.type).toBe("doc");
  });
});

describe("serializeTipTapJSON", () => {
  it("should serialize TipTap JSON to string", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Test" }] },
      ],
    };

    const result = serializeTipTapJSON(json);

    expect(typeof result).toBe("string");
    expect(JSON.parse(result)).toEqual(json);
  });

  it("should return empty doc for null", () => {
    const result = serializeTipTapJSON(null);
    const parsed = JSON.parse(result);

    expect(parsed.type).toBe("doc");
  });

  it("should handle already serialized string", () => {
    const jsonString = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });

    const result = serializeTipTapJSON(jsonString);

    // Should return the string as-is if it's already valid JSON
    expect(typeof result).toBe("string");
  });

  it("should convert plain text and serialize", () => {
    const result = serializeTipTapJSON("Plain text");
    const parsed = JSON.parse(result);

    expect(parsed.type).toBe("doc");
    expect(parsed.content).toBeDefined();
    expect(parsed.content[0].type).toBe("paragraph");
  });
});
