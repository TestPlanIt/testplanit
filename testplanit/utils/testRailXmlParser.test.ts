import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseStepsCell } from "~/lib/utils/parseExportedSteps";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";
import {
  convertTestRailSuiteToImportData,
  convertTestRailTables,
  isTestRailSuiteXml,
  parseTestRailEstimate,
  parseTestRailXml,
  replaceTestRailImages,
  TestRailXmlError,
} from "./testRailXmlParser";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", "testrail", name), "utf8");

const MARKER = "[image not imported]";

describe("parseTestRailXml on a real export (Xray sample)", () => {
  const suite = parseTestRailXml(fixture("xray-comic-estore.xml"));

  it("reads the suite and its section tree", () => {
    expect(suite.id).toBe("S196");
    expect(suite.name).toBe("Master");
    expect(suite.sections).toEqual([
      { path: ["Test Cases"], description: "" },
      { path: ["Test Cases", "Regression"], description: "Regression Tests" },
      {
        path: ["Exploratory Tests"],
        description: "Exploratory Test Section Description",
      },
      { path: ["Performance Tessts"], description: "" },
    ]);
  });

  it("reads every case with its section path", () => {
    expect(
      suite.cases.map((c) => [c.id, c.title, c.sectionPath.join(" / ")])
    ).toEqual([
      ["C22478", "Test Case Steps (Text)", "Test Cases"],
      ["C22494", "Automated Checkout", "Test Cases"],
      ["C22475", "Manual Test Case (Steps)", "Test Cases / Regression"],
      ["C22477", "Exploratory Session Test", "Exploratory Tests"],
      ["C22493", "Load Tests", "Performance Tessts"],
    ]);
  });

  it("counts cases per TestRail template", () => {
    expect(suite.templates).toEqual([
      { name: "functional area", count: 2 },
      { name: "Exploratory Session", count: 1 },
      { name: "Test Case (Steps)", count: 1 },
      { name: "Test Case (Text)", count: 1 },
    ]);
  });

  it("reads type, priority, preconditions and a dropdown's value", () => {
    const textCase = suite.cases[0];
    expect(textCase.type).toBe("Destructive");
    expect(textCase.priority).toBe("Medium");
    expect(textCase.preconditions).toBe("Test Case Step *TEXT* Precondition");
    expect(textCase.fields.automation_type).toBe("Manual");
    expect(suite.unrecognizedFields).toEqual([]);
  });

  it("turns the text layout into one step", () => {
    expect(suite.cases[0].steps).toEqual([
      {
        content: "%Var3 \n%Var4",
        expected:
          "![](index.php?/attachments/get/d8d1d9e0-fe4c-43c8-b894-dfd83d9c160c)",
        additionalInfo: "",
      },
    ]);
  });

  it("reads separated steps in order with their additional info", () => {
    const steps = suite.cases[2].steps;
    expect(steps).toHaveLength(5);
    expect(steps[1]).toEqual({
      content: "First step description",
      expected: "Expected result for the first step",
      additionalInfo: "Additional step description",
    });
  });

  it("moves an expected result typed into the step text to the expected result", () => {
    expect(suite.cases[2].steps[0]).toEqual({
      content: "Login with user *%User1*",
      expected:
        "Application redirects you to the main page in a logged in state",
      additionalInfo: "",
    });
  });

  it("leaves the step text alone when the step has its own expected result", () => {
    const xml = `<suite><sections><section><name>S</name><cases><case><title>T</title><custom><steps_separated>
<step><index>1</index><content>Do it
Expected Result:
typed inline</content><expected>the real one</expected></step>
<step><index>2</index><content>Expected result: nothing before it</content></step>
</steps_separated></custom></case></cases></section></sections></suite>`;
    const steps = parseTestRailXml(xml).cases[0].steps;
    expect(steps[0].content).toContain("typed inline");
    expect(steps[0].expected).toBe("the real one");
    expect(steps[1].expected).toBe("");
  });

  it("keeps exploratory fields and other case elements as fields", () => {
    expect(suite.cases[3].fields).toEqual({
      assignedto: "Cristiano Cunha",
      mission: "Exploratory Mission",
      goals: "Exploratory Goal",
    });
  });
});

describe("convertTestRailSuiteToImportData on the Xray sample", () => {
  const suite = parseTestRailXml(fixture("xray-comic-estore.xml"));
  const data = convertTestRailSuiteToImportData(suite, {
    imageMarker: MARKER,
  });

  it("lists only the columns that hold data", () => {
    expect(data.columns).toEqual([
      "Title",
      "Section",
      "TestRail ID",
      "TestRail Template",
      "Type",
      "Priority",
      "Preconditions",
      "Steps",
      "automation_type",
      "assignedto",
      "mission",
      "goals",
    ]);
  });

  it("sends the section as a list of folder names", () => {
    expect(data.rows[2].Section).toEqual(["Test Cases", "Regression"]);
  });

  it("counts the cases whose steps use TestRail variables", () => {
    // Only %Var1% and %Var2% in the Steps case are closed by a percent sign.
    expect(data.casesWithVariables).toBe(1);
  });

  it("replaces every image link and counts them", () => {
    expect(data.imageCount).toBe(4);
    expect(JSON.stringify(data.rows)).not.toContain("attachments/get");
  });

  it("writes steps the import route's step parser reads back", () => {
    const steps = parseStepsCell(data.rows[2].Steps);
    expect(steps).toHaveLength(5);
    expect(steps[1]).toEqual({
      step: "First step description\n\nAdditional step description",
      expectedResult: "Expected result for the first step",
      order: 1,
    });
    expect(steps[4]).toEqual({
      step: `${MARKER}\n\n${MARKER}`,
      expectedResult: MARKER,
      order: 4,
    });
  });

  it("rewrites the TestRail table as a markdown table", () => {
    const steps = parseStepsCell(data.rows[2].Steps);
    expect(steps[3].step).toContain(
      "| Name 1 | Last name 2 | Phone 3 | Address 4 |\n| --- | --- | --- | --- |\n| John .. | Smack | 111111111 | Address1 |"
    );
  });

  it("keeps the table a table once converted to rich text", () => {
    const steps = parseStepsCell(data.rows[2].Steps);
    const doc = ensureTipTapJSON(steps[3].step);
    const table = doc.content?.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(5);
    expect(table?.content?.[0].content?.map((cell) => cell.type)).toEqual([
      "tableHeader",
      "tableHeader",
      "tableHeader",
      "tableHeader",
    ]);
    expect(JSON.stringify(table?.content?.[4])).toContain("Mustang");
    expect(doc.content?.[0].type).toBe("paragraph");
  });

  it("carries the descriptions of sections that receive cases", () => {
    expect(data.folderDescriptions).toEqual([
      { path: ["Test Cases", "Regression"], description: "Regression Tests" },
      {
        path: ["Exploratory Tests"],
        description: "Exploratory Test Section Description",
      },
    ]);
  });

  it("keeps only one TestRail template when asked", () => {
    const filtered = convertTestRailSuiteToImportData(suite, {
      imageMarker: MARKER,
      template: "functional area",
    });
    expect(filtered.rows.map((row) => row.Title)).toEqual([
      "Automated Checkout",
      "Load Tests",
    ]);
    expect(filtered.columns).not.toContain("Steps");
    expect(filtered.folderDescriptions).toEqual([]);
    expect(filtered.imageCount).toBe(0);
  });

  it("puts sections under a suite folder when asked", () => {
    const nested = convertTestRailSuiteToImportData(suite, {
      imageMarker: MARKER,
      suiteFolderName: " Web shop ",
    });
    expect(nested.rows[2].Section).toEqual([
      "Web shop",
      "Test Cases",
      "Regression",
    ]);
    expect(nested.folderDescriptions[0].path).toEqual([
      "Web shop",
      "Test Cases",
      "Regression",
    ]);
  });
});

describe("handwritten suite", () => {
  const suite = parseTestRailXml(fixture("handwritten-suite.xml"));
  const data = convertTestRailSuiteToImportData(suite, {
    imageMarker: MARKER,
    suiteFolderName: "Billing",
  });

  it("keeps a section name holding separators as one folder", () => {
    expect(data.rows[0].Section).toEqual([
      "Billing",
      "Invoices / Credit notes",
    ]);
    expect(data.rows[2].Section).toEqual([
      "Billing",
      "Invoices / Credit notes",
      "v2.0 > drafts",
    ]);
  });

  it("decodes escaped HTML and replaces HTML images", () => {
    expect(data.rows[0].Preconditions).toBe(
      `<p>A customer exists</p>${MARKER}`
    );
    expect(data.imageCount).toBe(1);
  });

  it("orders separated steps by their index", () => {
    expect(parseStepsCell(data.rows[0].Steps).map((s) => s.step)).toEqual([
      "Open New invoice\n\nUse customer ACME",
      "Save the invoice",
    ]);
  });

  it("converts estimates to seconds and reports the unreadable ones", () => {
    expect(data.rows[0].Estimate).toBe("5400");
    expect(data.rows[2].Estimate).toBe("45");
    expect(data.rows[1].Estimate).toBeUndefined();
    expect(data.unreadEstimates).toEqual(["Estimate that cannot be read"]);
  });

  it("keeps references for issue linking", () => {
    expect(data.rows[0].References).toBe("BILL-12, BILL-40");
  });

  it("flattens an unknown nested field and reports it", () => {
    expect(data.rows[0].platforms).toBe("Web, iOS");
    expect(suite.unrecognizedFields).toEqual(["platforms"]);
  });

  it("renames a custom field that shares a fixed column's name", () => {
    expect(data.rows[0]["priority (custom)"]).toBe("Custom priority");
    expect(data.rows[0].Priority).toBe("High");
  });

  it("describes the suite folder and skips sections without cases", () => {
    expect(data.folderDescriptions).toEqual([
      { path: ["Billing"], description: "All billing checks" },
      {
        path: ["Billing", "Invoices / Credit notes"],
        description: "<p>Covers <strong>invoices</strong></p>",
      },
    ]);
  });
});

describe("parseTestRailXml errors", () => {
  it("rejects text that is not XML", () => {
    expect(() => parseTestRailXml("<suite><name>x</suite>")).toThrow(
      TestRailXmlError
    );
  });

  it("rejects XML with another root, such as a run export", () => {
    try {
      parseTestRailXml("<run><id>R1</id></run>");
      expect.unreachable();
    } catch (error) {
      expect((error as TestRailXmlError).code).toBe("not_a_suite");
    }
  });

  it("reads a suite with no sections as empty", () => {
    expect(parseTestRailXml("<suite><name>Empty</name></suite>").cases).toEqual(
      []
    );
  });
});

describe("isTestRailSuiteXml", () => {
  it("accepts a suite with or without the XML declaration", () => {
    expect(isTestRailSuiteXml(fixture("xray-comic-estore.xml"))).toBe(true);
    expect(isTestRailSuiteXml("  <suite>\n</suite>")).toBe(true);
  });

  it("rejects other XML", () => {
    expect(isTestRailSuiteXml('<?xml version="1.0"?><testsuites/>')).toBe(
      false
    );
    expect(isTestRailSuiteXml("<suites/>")).toBe(false);
  });
});

describe("parseTestRailEstimate", () => {
  it.each([
    ["30s", 30],
    ["1m 30s", 90],
    ["2h", 7200],
    ["1h 30m", 5400],
    ["1d", 28800],
    ["1w", 144000],
    ["2 hours 5 minutes", 7500],
    ["90", 90],
  ])("reads %s", (input, seconds) => {
    expect(parseTestRailEstimate(input)).toBe(seconds);
  });

  it.each(["", "soon", "1x", "about 2h"])("returns null for %j", (input) => {
    expect(parseTestRailEstimate(input)).toBeNull();
  });
});

describe("replaceTestRailImages", () => {
  it("leaves images that do not point at TestRail", () => {
    const text = "![logo](https://example.com/logo.png)";
    expect(replaceTestRailImages(text, MARKER)).toEqual({ text, count: 0 });
  });
});

describe("convertTestRailTables", () => {
  it("leaves text without a TestRail table untouched", () => {
    const text = "a || b\n| x | y |";
    expect(convertTestRailTables(text)).toBe(text);
  });
});
