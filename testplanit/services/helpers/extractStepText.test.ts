import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractStepText } from "./extractStepText";
import { extractTextFromNode } from "../../utils/extractTextFromJson";

// Mock extractTextFromNode
vi.mock("../../utils/extractTextFromJson", () => ({
  extractTextFromNode: vi.fn(),
}));

describe("extractStepText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty string for null input", () => {
    const result = extractStepText(null);
    expect(result).toBe("");
    expect(extractTextFromNode).not.toHaveBeenCalled();
  });

  it("should return empty string for undefined input", () => {
    const result = extractStepText(undefined);
    expect(result).toBe("");
    expect(extractTextFromNode).not.toHaveBeenCalled();
  });

  it("should return empty string for empty string input", () => {
    const result = extractStepText("");
    expect(result).toBe("");
    expect(extractTextFromNode).not.toHaveBeenCalled();
  });

  it("should parse valid JSON string and extract text", () => {
    const jsonString = '{"type":"doc","content":[{"type":"text","text":"Hello"}]}';
    const parsedObj = { type: "doc", content: [{ type: "text", text: "Hello" }] };
    
    vi.mocked(extractTextFromNode).mockReturnValue("Hello");
    
    const result = extractStepText(jsonString);
    
    expect(extractTextFromNode).toHaveBeenCalledWith(parsedObj);
    expect(result).toBe("Hello");
  });

  it("should handle object input directly", () => {
    const obj = { type: "doc", content: [{ type: "text", text: "World" }] };
    
    vi.mocked(extractTextFromNode).mockReturnValue("World");
    
    const result = extractStepText(obj);
    
    expect(extractTextFromNode).toHaveBeenCalledWith(obj);
    expect(result).toBe("World");
  });

  it("should return original string for invalid JSON", () => {
    const invalidJson = "Not a JSON string";
    
    const result = extractStepText(invalidJson);
    
    expect(extractTextFromNode).not.toHaveBeenCalled();
    expect(result).toBe("Not a JSON string");
  });

  it("should return original string for malformed JSON", () => {
    const malformedJson = '{"unclosed": "json';
    
    const result = extractStepText(malformedJson);
    
    expect(extractTextFromNode).not.toHaveBeenCalled();
    expect(result).toBe(malformedJson);
  });

  it("should handle complex nested JSON structure", () => {
    const complexJson = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Step 1: " },
            { type: "text", text: "Click button" }
          ]
        }
      ]
    });
    
    vi.mocked(extractTextFromNode).mockReturnValue("Step 1: Click button");
    
    const result = extractStepText(complexJson);
    
    expect(result).toBe("Step 1: Click button");
  });

  it("should handle empty object", () => {
    vi.mocked(extractTextFromNode).mockReturnValue("");
    
    const result = extractStepText({});
    
    expect(extractTextFromNode).toHaveBeenCalledWith({});
    expect(result).toBe("");
  });

  it("should handle non-string non-object types", () => {
    expect(extractStepText(123)).toBe("");
    expect(extractStepText(true)).toBe("");
    expect(extractStepText([])).toBe("");
  });

  it("should handle JSON with null values", () => {
    const jsonWithNull = '{"type":"doc","content":null}';
    
    vi.mocked(extractTextFromNode).mockReturnValue("");
    
    const result = extractStepText(jsonWithNull);
    
    expect(extractTextFromNode).toHaveBeenCalledWith({ type: "doc", content: null });
    expect(result).toBe("");
  });

  it("should handle JSON strings with special characters", () => {
    const jsonWithSpecialChars = '{"text":"Line 1\\nLine 2\\tTabbed"}';
    
    vi.mocked(extractTextFromNode).mockReturnValue("Line 1\nLine 2\tTabbed");
    
    const result = extractStepText(jsonWithSpecialChars);
    
    expect(result).toBe("Line 1\nLine 2\tTabbed");
  });

  it("should return empty string when extractTextFromNode throws an error", () => {
    const obj = { type: "doc" };
    
    vi.mocked(extractTextFromNode).mockImplementation(() => {
      throw new Error("Extraction failed");
    });
    
    const result = extractStepText(obj);
    
    expect(result).toBe("");
  });

  it("should handle very large JSON strings", () => {
    const largeContent = Array(1000).fill({ type: "text", text: "repeated" });
    const largeJson = JSON.stringify({
      type: "doc",
      content: largeContent
    });
    
    vi.mocked(extractTextFromNode).mockReturnValue("Large content extracted");
    
    const result = extractStepText(largeJson);
    
    expect(result).toBe("Large content extracted");
  });

  it("should handle JSON with unicode characters", () => {
    const unicodeJson = '{"text":"Hello 👋 世界 🌍"}';
    
    vi.mocked(extractTextFromNode).mockReturnValue("Hello 👋 世界 🌍");
    
    const result = extractStepText(unicodeJson);
    
    expect(result).toBe("Hello 👋 世界 🌍");
  });
});