import { describe, expect, it } from "vitest";

import {
  extractEntityContent,
  extractFieldValue,
  extractTiptapText
} from "./content-extractor";

describe("extractTiptapText", () => {
  it("extracts text from a simple paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    };
    expect(extractTiptapText(doc)).toBe("Hello world");
  });

  it("extracts text from nested heading + paragraphs", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First " },
            { type: "text", text: "paragraph" },
          ],
        },
      ],
    };
    expect(extractTiptapText(doc)).toBe("Title First paragraph");
  });

  it("returns empty string for null input", () => {
    expect(extractTiptapText(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(extractTiptapText(undefined)).toBe("");
  });

  it("returns the string as-is for string input", () => {
    expect(extractTiptapText("plain text")).toBe("plain text");
  });

  it("returns empty string for empty content array", () => {
    const doc = { type: "doc", content: [] };
    expect(extractTiptapText(doc)).toBe("");
  });
});

describe("extractFieldValue", () => {
  it("handles string value", () => {
    expect(extractFieldValue({ value: "hello" })).toBe("hello");
  });

  it("handles number value", () => {
    expect(extractFieldValue({ value: 42 })).toBe("42");
  });

  it("handles boolean value", () => {
    expect(extractFieldValue({ value: true })).toBe("true");
  });

  it("handles array value (multiselect)", () => {
    expect(extractFieldValue({ value: ["a", "b", "c"] })).toBe("a, b, c");
  });

  it("handles null value", () => {
    expect(extractFieldValue({ value: null })).toBe("");
  });

  it("handles undefined value", () => {
    expect(extractFieldValue({ value: undefined })).toBe("");
  });

  it("handles object value", () => {
    expect(extractFieldValue({ value: { key: "val" } })).toBe(
      '{"key":"val"}',
    );
  });
});

describe("extractEntityContent", () => {
  describe("repositoryCase", () => {
    it("extracts content from a repository case with all fields", () => {
      const entity = {
        id: 1,
        name: "Login test case",
        steps: [
          {
            step: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Enter username" }],
                },
              ],
            },
            expectedResult: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Field accepts input" }],
                },
              ],
            },
          },
        ],
        caseFieldValues: [
          {
            value: "High",
            field: { name: "Priority" },
          },
        ],
        tags: [{ name: "login" }, { name: "smoke" }],
      };

      const result = extractEntityContent(
        entity,
        "repositoryCase",
        "Auth / Login",
      );

      expect(result.id).toBe(1);
      expect(result.entityType).toBe("repositoryCase");
      expect(result.name).toBe("Login test case");
      expect(result.textContent).toContain("Folder: Auth / Login");
      expect(result.textContent).toContain("Login test case");
      expect(result.textContent).toContain("Step: Enter username");
      expect(result.textContent).toContain("Expected: Field accepts input");
      expect(result.textContent).toContain("Priority: High");
      expect(result.existingTagNames).toEqual(["login", "smoke"]);
      expect(result.estimatedTokens).toBe(
        Math.ceil(result.textContent.length / 4),
      );
    });

    it("handles case without folder path", () => {
      const entity = {
        id: 2,
        name: "Simple case",
        steps: [],
        caseFieldValues: [],
        tags: [],
      };

      const result = extractEntityContent(entity, "repositoryCase");
      expect(result.textContent).toBe("Simple case");
      expect(result.existingTagNames).toEqual([]);
    });
  });

  describe("testRun", () => {
    it("extracts content from a test run", () => {
      const entity = {
        id: 10,
        name: "Sprint 5 regression",
        note: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Regression testing for API" }],
            },
          ],
        },
        docs: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "See JIRA-123" }],
            },
          ],
        },
        tags: [{ name: "regression" }],
      };

      const result = extractEntityContent(entity, "testRun");

      expect(result.id).toBe(10);
      expect(result.entityType).toBe("testRun");
      expect(result.textContent).toContain("Sprint 5 regression");
      expect(result.textContent).toContain("Regression testing for API");
      expect(result.textContent).toContain("See JIRA-123");
      expect(result.existingTagNames).toEqual(["regression"]);
    });

    it("handles test run with null note and docs", () => {
      const entity = {
        id: 11,
        name: "Empty run",
        note: null,
        docs: null,
        tags: [],
      };

      const result = extractEntityContent(entity, "testRun");
      expect(result.textContent).toBe("Empty run");
    });
  });

  describe("session", () => {
    it("extracts content from a session", () => {
      const entity = {
        id: 20,
        name: "Exploratory: Payment flow",
        note: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Found edge case in checkout" }],
            },
          ],
        },
        mission: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Test payment integrations" }],
            },
          ],
        },
        sessionFieldValues: [
          {
            value: "Critical",
            field: { name: "Severity" },
          },
        ],
        tags: [{ name: "payment" }],
      };

      const result = extractEntityContent(entity, "session");

      expect(result.id).toBe(20);
      expect(result.entityType).toBe("session");
      expect(result.textContent).toContain("Exploratory: Payment flow");
      expect(result.textContent).toContain("Found edge case in checkout");
      expect(result.textContent).toContain("Test payment integrations");
      expect(result.textContent).toContain("Severity: Critical");
      expect(result.existingTagNames).toEqual(["payment"]);
    });

    it("handles session with no field values", () => {
      const entity = {
        id: 21,
        name: "Quick session",
        note: null,
        mission: null,
        sessionFieldValues: [],
        tags: [],
      };

      const result = extractEntityContent(entity, "session");
      expect(result.textContent).toBe("Quick session");
    });
  });
});
