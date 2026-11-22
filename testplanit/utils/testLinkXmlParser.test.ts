import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseStepsCell } from "~/lib/utils/parseExportedSteps";
import {
  convertTestLinkSpecToImportData,
  isTestLinkXml,
  parseTestLinkDuration,
  parseTestLinkXml,
  testLinkAttachmentToFile,
  TestLinkXmlError,
} from "./testLinkXmlParser";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", "testlink", name), "utf8");

const errorCode = (xml: string) => {
  try {
    parseTestLinkXml(xml);
  } catch (error) {
    return error instanceof TestLinkXmlError ? error.code : "other";
  }
  return "none";
};

describe("parseTestLinkXml on a whole-project export", () => {
  const spec = parseTestLinkXml(fixture("handwritten-project.xml"));

  it("reads the suite tree and leaves the unnamed root out", () => {
    expect(spec.suites).toEqual([
      {
        path: ["Checkout"],
        details:
          "<p>Everything a shopper does between the <strong>basket</strong> and the receipt.</p>",
      },
      { path: ["Checkout", "Refunds / returns"], details: "" },
      { path: ["Empty suite"], details: "<p>Nothing here yet.</p>" },
    ]);
  });

  it("reads every case with its suite path", () => {
    expect(
      spec.cases.map((c) => [c.externalId, c.name, c.suitePath.join(" > ")])
    ).toEqual([
      ["SHOP-1", "Pay with a saved card", "Checkout"],
      ["SHOP-2", "Refund a delivered order", "Checkout > Refunds / returns"],
    ]);
  });

  it("reads the case fields", () => {
    const [card, refund] = spec.cases;
    expect(card.version).toBe("3");
    expect(card.summary).toBe(
      "<p>A returning shopper pays with the card on file.</p>"
    );
    expect(card.preconditions).toContain("<li>A card is saved</li>");
    expect(card.executionType).toBe("1");
    expect(card.importance).toBe("3");
    expect(card.status).toBe("7");
    expect(card.estimatedDuration).toBe("2.50");
    expect(card.active).toBe(true);
    expect(refund.active).toBe(false);
  });

  it("orders steps by their number and drops empty ones", () => {
    const [card, refund] = spec.cases;
    expect(card.steps).toEqual([
      {
        actions: "<p>Open the basket and select <em>Pay</em></p>",
        expected: "<p>The saved card is offered first</p>",
      },
      {
        actions: "<p>Choose the saved card and confirm</p>",
        expected: "<p>The receipt page shows the order total</p>",
      },
    ]);
    expect(refund.steps).toEqual([]);
  });

  it("reads keywords, platforms, requirements and custom fields", () => {
    const card = spec.cases[0];
    expect(card.keywords).toEqual(["Smoke", "Payments, cards"]);
    expect(card.platforms).toEqual(["Desktop", "Mobile"]);
    expect(card.requirements).toEqual([
      { docId: "PAY-010", title: "Saved cards", specTitle: "Payments" },
      { docId: "PAY-014", title: "Receipts", specTitle: "Payments" },
    ]);
    expect(card.customFields).toEqual({
      Browsers: "Chrome|Firefox",
      Status: "Reviewed by QA",
    });
  });

  it("reads the files attached to cases and counts the rest", () => {
    expect(spec.cases[0].attachments).toEqual([
      {
        name: "card-form.txt",
        mimeType: "text/plain",
        title: "",
        content: "aGVsbG8=",
      },
    ]);
    expect(spec.caseAttachmentCount).toBe(1);
    expect(spec.suiteAttachmentCount).toBe(1);
    expect(spec.relationCount).toBe(1);
  });
});

describe("parseTestLinkXml on a test case export", () => {
  const spec = parseTestLinkXml(fixture("handwritten-testcases.xml"));

  it("reads cases without a suite", () => {
    expect(spec.suites).toEqual([]);
    expect(spec.cases.map((c) => [c.externalId, c.name, c.suitePath])).toEqual([
      ["7", "Sign in with a wrong password", []],
      ["8", "Sign out", []],
    ]);
  });

  it("reads the layout used before TestLink 1.9 as one step", () => {
    const old = spec.cases[0];
    expect(old.steps).toEqual([
      {
        actions: "<p>Enter a wrong password three times</p>",
        expected: "<p>The form reports a wrong password each time</p>",
      },
    ]);
    expect(old.executionType).toBe("2");
  });
});

describe("parseTestLinkXml on other input", () => {
  it("rejects text that is not XML", () => {
    expect(errorCode("<testsuite name='a'><testcase")).toBe("invalid_xml");
  });

  it("rejects another XML format", () => {
    expect(errorCode("<suite><name>Master</name></suite>")).toBe(
      "not_testlink"
    );
  });

  it("rejects a JUnit results file", () => {
    const junit =
      '<testsuite name="unit" tests="2" failures="0"><testcase name="a" classname="b"/></testsuite>';
    expect(isTestLinkXml(junit)).toBe(false);
    expect(errorCode(junit)).toBe("not_testlink");
  });

  it("rejects a file with a document type", () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE testcases [<!ENTITY x SYSTEM "file:///etc/passwd">]><testcases><testcase name="&x;"/></testcases>';
    expect(errorCode(xml)).toBe("invalid_xml");
  });

  it("recognizes both roots after a declaration and a comment", () => {
    expect(
      isTestLinkXml('<?xml version="1.0"?>\n<!-- x -->\n<testsuite name="">')
    ).toBe(true);
    expect(isTestLinkXml("<testcases>")).toBe(true);
    expect(isTestLinkXml("<testsuites>")).toBe(false);
  });
});

describe("parseTestLinkDuration", () => {
  it("converts minutes to seconds", () => {
    expect(parseTestLinkDuration("2.50")).toBe(150);
    expect(parseTestLinkDuration("10")).toBe(600);
    expect(parseTestLinkDuration("0,5")).toBe(30);
  });

  it("returns null for other text", () => {
    expect(parseTestLinkDuration("soon")).toBeNull();
    expect(parseTestLinkDuration("")).toBeNull();
  });
});

describe("convertTestLinkSpecToImportData", () => {
  const project = convertTestLinkSpecToImportData(
    parseTestLinkXml(fixture("handwritten-project.xml"))
  );

  it("lists only the columns that hold a value", () => {
    expect(project.columns).toEqual([
      "Name",
      "Test Suite",
      "TestLink ID",
      "Summary",
      "Preconditions",
      "Steps",
      "Importance",
      "Automated",
      "Status",
      "Estimate",
      "Keywords",
      "Requirements",
      "Platforms",
      "Active",
      "Attachments",
      "Browsers",
      "Status (custom)",
    ]);
  });

  it("writes TestLink's codes as their labels", () => {
    const [card, refund] = project.rows;
    expect(card["Importance"]).toBe("High");
    expect(card["Automated"]).toBe("No");
    expect(card["Status"]).toBe("Final");
    expect(card["Active"]).toBe("Yes");
    expect(refund["Importance"]).toBe("Low");
    expect(refund["Automated"]).toBe("Yes");
    expect(refund["Status"]).toBe("Draft");
    expect(refund["Active"]).toBe("No");
  });

  it("keeps the suite path as a list of names", () => {
    expect(project.rows[1]["Test Suite"]).toEqual([
      "Checkout",
      "Refunds / returns",
    ]);
  });

  it("writes steps in the form the import reads back", () => {
    const steps = parseStepsCell(project.rows[0]["Steps"]);
    expect(steps.map((s) => [s.step, s.expectedResult])).toEqual([
      [
        "<p>Open the basket and select <em>Pay</em></p>",
        "<p>The saved card is offered first</p>",
      ],
      [
        "<p>Choose the saved card and confirm</p>",
        "<p>The receipt page shows the order total</p>",
      ],
    ]);
    expect(project.rows[1]["Steps"]).toBeUndefined();
  });

  it("converts the estimate to seconds", () => {
    expect(project.rows[0]["Estimate"]).toBe("150");
    expect(project.unreadEstimates).toBe(0);
  });

  it("keeps a keyword that contains a comma whole", () => {
    expect(JSON.parse(project.rows[0]["Keywords"])).toEqual([
      "Smoke",
      "Payments, cards",
    ]);
  });

  it("lists requirement document IDs and platforms", () => {
    expect(project.rows[0]["Requirements"]).toBe("PAY-010, PAY-014");
    expect(project.rows[0]["Platforms"]).toBe("Desktop, Mobile");
  });

  it("renames a custom field that shares a fixed column's name", () => {
    expect(project.rows[0]["Status (custom)"]).toBe("Reviewed by QA");
    expect(project.rows[0]["Browsers"]).toBe("Chrome|Firefox");
  });

  it("lists attachment names and keeps the files in row order", async () => {
    expect(project.rows[0]["Attachments"]).toBe("card-form.txt");
    expect(project.rows[1]["Attachments"]).toBeUndefined();
    expect(project.attachments.map((files) => files.length)).toEqual([1, 0]);

    const file = testLinkAttachmentToFile(project.attachments[0][0]);
    expect(file.name).toBe("card-form.txt");
    expect(file.type).toBe("text/plain");
    expect(await file.text()).toBe("hello");
  });

  it("rejects attachment content that is not base64", () => {
    expect(() =>
      testLinkAttachmentToFile({
        name: "a.bin",
        mimeType: "",
        title: "",
        content: "not base64!",
      })
    ).toThrow();
  });

  it("describes only the suites that hold imported cases", () => {
    expect(project.folderDescriptions).toEqual([
      {
        path: ["Checkout"],
        description:
          "<p>Everything a shopper does between the <strong>basket</strong> and the receipt.</p>",
      },
    ]);
  });

  it("passes unknown codes through and counts unread estimates", () => {
    const cases = convertTestLinkSpecToImportData(
      parseTestLinkXml(fixture("handwritten-testcases.xml"))
    );
    expect(cases.columns).not.toContain("Test Suite");
    expect(cases.columns).not.toContain("Active");
    expect(cases.rows[1]["Importance"]).toBe("9");
    expect(cases.rows[1]["Status"]).toBe("42");
    expect(cases.rows[1]["Estimate"]).toBeUndefined();
    expect(cases.unreadEstimates).toBe(1);
    expect(cases.rows[0]["Keywords"]).toBeUndefined();
  });
});
