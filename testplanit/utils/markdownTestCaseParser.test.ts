import { describe, expect, it } from "vitest";
import {
  convertMarkdownCasesToImportData, parseMarkdownTestCases
} from "./markdownTestCaseParser";

describe("parseMarkdownTestCases", () => {
  describe("empty / minimal input", () => {
    it("should return empty result for empty string", () => {
      const result = parseMarkdownTestCases("");
      expect(result.cases).toHaveLength(0);
      expect(result.format).toBe("single");
    });

    it("should return empty result for whitespace-only string", () => {
      const result = parseMarkdownTestCases("   \n\n   ");
      expect(result.cases).toHaveLength(0);
    });
  });

  describe("heading-based format (multi-case)", () => {
    it("should parse multiple test cases from top-level headings", () => {
      const md = `# Login Test
Description of login test

## Steps
1. Navigate to login page
2. Enter credentials

## Tags
smoke, login

# Logout Test
## Steps
1. Click logout button
`;
      const result = parseMarkdownTestCases(md);
      expect(result.format).toBe("heading");
      expect(result.cases).toHaveLength(2);

      expect(result.cases[0].name).toBe("Login Test");
      expect(result.cases[0].description).toBe("Description of login test");
      expect(result.cases[0].steps).toHaveLength(2);
      expect(result.cases[0].steps[0].action).toBe("Navigate to login page");
      expect(result.cases[0].tags).toEqual(["smoke", "login"]);

      expect(result.cases[1].name).toBe("Logout Test");
      expect(result.cases[1].steps).toHaveLength(1);
      expect(result.cases[1].steps[0].action).toBe("Click logout button");
    });

    it("should parse inline expected results with -> separator", () => {
      const md = `# Test Case
## Steps
1. Click submit -> Form is submitted
2. Check status -> Status shows success
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps).toHaveLength(2);
      expect(result.cases[0].steps[0].action).toBe("Click submit");
      expect(result.cases[0].steps[0].expectedResult).toBe("Form is submitted");
      expect(result.cases[0].steps[1].action).toBe("Check status");
      expect(result.cases[0].steps[1].expectedResult).toBe("Status shows success");
    });

    it("should parse inline expected results with | separator", () => {
      const md = `# Test Case
## Steps
1. Click submit | Form is submitted
2. Check status | Status shows success
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps[0].action).toBe("Click submit");
      expect(result.cases[0].steps[0].expectedResult).toBe("Form is submitted");
    });

    it("should parse separate Steps and Expected Results sections", () => {
      const md = `# Login Test

## Steps
1. Navigate to login page
2. Enter credentials
3. Click submit

## Expected Results
1. Login page loads
2. Fields accept input
3. User is redirected
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps).toHaveLength(3);
      expect(result.cases[0].steps[0].action).toBe("Navigate to login page");
      expect(result.cases[0].steps[0].expectedResult).toBe("Login page loads");
      expect(result.cases[0].steps[2].action).toBe("Click submit");
      expect(result.cases[0].steps[2].expectedResult).toBe("User is redirected");
    });

    it("should handle preconditions section", () => {
      const md = `# Test Case
## Preconditions
User must be logged in

## Steps
1. Do something
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].preconditions).toContain("User must be logged in");
    });

    it("should handle prerequisites as alias for preconditions", () => {
      const md = `# Test Case
## Prerequisites
- Account exists
- User is active

## Steps
1. Do something
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].preconditions).toBeTruthy();
    });

    it("should store custom sections by heading text", () => {
      const md = `# Test Case
## Steps
1. Do something

## Priority
High

## Notes
Some additional notes here
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0]["Priority"]).toContain("High");
      expect(result.cases[0]["Notes"]).toContain("Some additional notes here");
    });

    it("should handle ## level headings as top-level when no # headings", () => {
      const md = `## Test Case One
### Steps
1. Step one

## Test Case Two
### Steps
1. Step two
`;
      const result = parseMarkdownTestCases(md);
      expect(result.format).toBe("heading");
      expect(result.cases).toHaveLength(2);
      expect(result.cases[0].name).toBe("Test Case One");
      expect(result.cases[1].name).toBe("Test Case Two");
    });

    it("should parse tags from a list", () => {
      const md = `# Test
## Tags
- smoke
- regression
- login
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].tags).toEqual(["smoke", "regression", "login"]);
    });

    it("should handle description text between case heading and first sub-heading", () => {
      const md = `# Login Feature Test
This test validates the login feature works correctly.
It should handle both valid and invalid credentials.

## Steps
1. Navigate to login
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].description).toContain("This test validates the login feature");
    });
  });

  describe("table-based format", () => {
    it("should parse test cases from a markdown table", () => {
      const md = `| Name | Steps | Expected Result | Tags |
|------|-------|-----------------|------|
| Login Test | Navigate to login page | Page loads | login, smoke |
| Register Test | Click register | Form shown | register |
`;
      const result = parseMarkdownTestCases(md);
      expect(result.format).toBe("table");
      expect(result.cases).toHaveLength(2);
      expect(result.cases[0].name).toBe("Login Test");
      expect(result.cases[0].steps).toHaveLength(1);
      expect(result.cases[0].steps[0].action).toBe("Navigate to login page");
      expect(result.cases[0].tags).toEqual(["login", "smoke"]);

      expect(result.cases[1].name).toBe("Register Test");
    });

    it("should recognize 'Title' as name column", () => {
      const md = `| Title | Description |
|-------|-------------|
| My Test | Test description |
`;
      const result = parseMarkdownTestCases(md);
      expect(result.format).toBe("table");
      expect(result.cases[0].name).toBe("My Test");
      expect(result.cases[0].description).toBe("Test description");
    });

    it("should store unrecognized columns as custom fields", () => {
      const md = `| Name | Priority | Environment |
|------|----------|-------------|
| Test | High | Production |
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].name).toBe("Test");
      expect(result.cases[0]["Priority"]).toBe("High");
      expect(result.cases[0]["Environment"]).toBe("Production");
    });

    it("should not parse table with unrelated headers", () => {
      const md = `| Feature | Version | Author |
|---------|---------|--------|
| Auth | 1.0 | Bob |

# Test Case
## Steps
1. Do something
`;
      const result = parseMarkdownTestCases(md);
      // Should fall through to heading-based since table has no test case headers
      expect(result.format).not.toBe("table");
    });
  });

  describe("single case format", () => {
    it("should parse a single case with section headings only", () => {
      const md = `## Steps
1. Navigate to login
2. Enter credentials

## Expected Results
1. Login page loads
2. Dashboard shown
`;
      const result = parseMarkdownTestCases(md);
      // All headings are known section names at same depth → single case
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].steps).toHaveLength(2);
      expect(result.cases[0].steps[0].expectedResult).toBe("Login page loads");
      expect(result.cases[0].steps[1].expectedResult).toBe("Dashboard shown");
    });

    it("should parse a single case with title heading", () => {
      const md = `# My Test Case

## Steps
1. Step one
2. Step two
`;
      const result = parseMarkdownTestCases(md);
      // Single top-level heading with known sub-sections → heading format
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].name).toBe("My Test Case");
      expect(result.cases[0].steps).toHaveLength(2);
    });

    it("should treat plain list as steps when no headings", () => {
      const md = `1. Navigate to page
2. Click button
3. Verify result
`;
      const result = parseMarkdownTestCases(md);
      expect(result.format).toBe("single");
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].steps).toHaveLength(3);
      expect(result.cases[0].steps[0].action).toBe("Navigate to page");
    });

    it("should treat plain text (no list, no headings) as description", () => {
      const md = `This is a test case about user authentication.
It validates that users can log in correctly.`;
      const result = parseMarkdownTestCases(md);
      expect(result.format).toBe("single");
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].description).toBeTruthy();
    });

    it("should handle bullet list steps", () => {
      const md = `## Steps
- Navigate to page
- Click button
- Verify result
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps).toHaveLength(3);
      expect(result.cases[0].steps[0].action).toBe("Navigate to page");
    });
  });

  describe("step parsing edge cases", () => {
    it("should not split on || (logical OR)", () => {
      const md = `# Test
## Steps
1. Check if value is true || false -> Result shown
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps[0].action).toBe(
        "Check if value is true || false"
      );
      expect(result.cases[0].steps[0].expectedResult).toBe("Result shown");
    });

    it("should handle steps without expected results", () => {
      const md = `# Test
## Steps
1. Navigate to page
2. Click button
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps[0].expectedResult).toBeUndefined();
      expect(result.cases[0].steps[1].expectedResult).toBeUndefined();
    });

    it("should handle mixed steps (some with, some without expected results)", () => {
      const md = `# Test
## Steps
1. Navigate to page
2. Click submit -> Form submits
3. Wait for response
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps[0].expectedResult).toBeUndefined();
      expect(result.cases[0].steps[1].expectedResult).toBe("Form submits");
      expect(result.cases[0].steps[2].expectedResult).toBeUndefined();
    });

    it("should handle mismatched step/expected result counts in separate sections", () => {
      const md = `# Test
## Steps
1. Step one
2. Step two
3. Step three

## Expected Results
1. Result one
2. Result two
`;
      const result = parseMarkdownTestCases(md);
      expect(result.cases[0].steps).toHaveLength(3);
      expect(result.cases[0].steps[0].expectedResult).toBe("Result one");
      expect(result.cases[0].steps[1].expectedResult).toBe("Result two");
      expect(result.cases[0].steps[2].expectedResult).toBeUndefined();
    });
  });

  describe("detectedColumns", () => {
    it("should detect all used fields as columns", () => {
      const md = `# Test
Description here

## Steps
1. Do thing

## Tags
smoke

## Preconditions
Must be logged in
`;
      const result = parseMarkdownTestCases(md);
      expect(result.detectedColumns).toContain("name");
      expect(result.detectedColumns).toContain("description");
      expect(result.detectedColumns).toContain("steps");
      expect(result.detectedColumns).toContain("tags");
      expect(result.detectedColumns).toContain("preconditions");
    });

    it("should include custom section names in columns", () => {
      const md = `# Test
## Steps
1. Do thing

## Priority
High
`;
      const result = parseMarkdownTestCases(md);
      expect(result.detectedColumns).toContain("Priority");
    });
  });
});

describe("convertMarkdownCasesToImportData", () => {
  it("should convert parsed cases to import row format", () => {
    const result = parseMarkdownTestCases(`# Login Test
## Steps
1. Navigate to login -> Page loads
2. Enter credentials -> Fields accept input

## Tags
smoke, login
`);

    const { rows, columns } = convertMarkdownCasesToImportData(result);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Login Test");
    expect(rows[0].steps).toContain("1. Navigate to login | Page loads");
    expect(rows[0].steps).toContain("2. Enter credentials | Fields accept input");
    expect(rows[0].tags).toBe("smoke, login");
    expect(columns).toContain("name");
    expect(columns).toContain("steps");
    expect(columns).toContain("tags");
  });

  it("should handle steps without expected results in export format", () => {
    const result = parseMarkdownTestCases(`# Test
## Steps
1. Navigate to page
2. Click button
`);

    const { rows } = convertMarkdownCasesToImportData(result);

    expect(rows[0].steps).toBe("1. Navigate to page\n2. Click button");
  });

  it("should include description and preconditions", () => {
    const result = parseMarkdownTestCases(`# Test
Some description

## Preconditions
Must be logged in

## Steps
1. Do thing
`);

    const { rows } = convertMarkdownCasesToImportData(result);

    expect(rows[0].description).toBeTruthy();
    expect(rows[0].preconditions).toContain("Must be logged in");
  });

  it("should include custom fields in rows", () => {
    const result = parseMarkdownTestCases(`# Test
## Steps
1. Do thing

## Priority
High
`);

    const { rows } = convertMarkdownCasesToImportData(result);
    expect(rows[0]["Priority"]).toContain("High");
  });

  it("should handle multiple cases from heading format", () => {
    const result = parseMarkdownTestCases(`# Test One
## Steps
1. Step A

# Test Two
## Steps
1. Step B
`);

    const { rows } = convertMarkdownCasesToImportData(result);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Test One");
    expect(rows[1].name).toBe("Test Two");
  });
});
