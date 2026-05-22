import { describe, expect, it } from "vitest";
import {
  aggregateMultiRowSteps,
  inspectMultiRowAggregation,
} from "./aggregateMultiRowSteps";

describe("aggregateMultiRowSteps", () => {
  it("collapses continuation rows into the head row's _aggregatedSteps", () => {
    const rows = [
      {
        ID: "1",
        Name: "Login flow",
        Description: "Verify login",
        "Step #": "1",
        "Step Content": "Open login page",
        "Expected Result": "Login form renders",
      },
      {
        ID: "1",
        Name: "Login flow",
        Description: "",
        "Step #": "2",
        "Step Content": "Enter credentials",
        "Expected Result": "Dashboard appears",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
      { csvColumn: "Description", templateField: "description" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].Description).toBe("Verify login");
    expect(result[0]._aggregatedSteps).toEqual([
      {
        step: "Open login page",
        expectedResult: "Login form renders",
        order: 0,
      },
      {
        step: "Enter credentials",
        expectedResult: "Dashboard appears",
        order: 1,
      },
    ]);
  });

  it("starts a new aggregated case when ID changes", () => {
    const rows = [
      {
        ID: "1",
        Name: "Case A",
        "Step #": "1",
        "Step Content": "A step 1",
        "Expected Result": "A result 1",
      },
      {
        ID: "1",
        Name: "Case A",
        "Step #": "2",
        "Step Content": "A step 2",
        "Expected Result": "",
      },
      {
        ID: "2",
        Name: "Case B",
        "Step #": "1",
        "Step Content": "B step 1",
        "Expected Result": "B result 1",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]._aggregatedSteps).toHaveLength(2);
    expect(result[1]._aggregatedSteps).toHaveLength(1);
    expect(result[1]._aggregatedSteps[0].step).toBe("B step 1");
  });

  it("groups by Name when no ID column is mapped", () => {
    const rows = [
      {
        Name: "Case A",
        "Step #": "1",
        "Step Content": "A1",
        "Expected Result": "",
      },
      {
        Name: "Case A",
        "Step #": "2",
        "Step Content": "A2",
        "Expected Result": "",
      },
      {
        Name: "Case B",
        "Step #": "1",
        "Step Content": "B1",
        "Expected Result": "",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].Name).toBe("Case A");
    expect(result[0]._aggregatedSteps).toHaveLength(2);
    expect(result[1].Name).toBe("Case B");
  });

  it("preserves expected-result-only continuation rows", () => {
    const rows = [
      {
        ID: "1",
        Name: "x",
        "Step #": "1",
        "Step Content": "Open page",
        "Expected Result": "",
      },
      {
        ID: "1",
        Name: "x",
        "Step #": "2",
        "Step Content": "",
        "Expected Result": "Banner is hidden",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]._aggregatedSteps).toEqual([
      { step: "Open page", expectedResult: "", order: 0 },
      { step: "", expectedResult: "Banner is hidden", order: 1 },
    ]);
  });

  it("skips continuation rows with no step content and no expected result", () => {
    const rows = [
      {
        ID: "1",
        Name: "x",
        "Step #": "1",
        "Step Content": "Step",
        "Expected Result": "",
      },
      {
        ID: "1",
        Name: "x",
        "Step #": "",
        "Step Content": "",
        "Expected Result": "",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]._aggregatedSteps).toHaveLength(1);
  });

  it("returns input unchanged when no step columns are present", () => {
    const rows = [{ ID: "1", Name: "x", Description: "y" }];
    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);
    expect(result).toBe(rows);
  });

  it("returns input unchanged for empty input", () => {
    expect(aggregateMultiRowSteps([], [])).toEqual([]);
  });

  it("groups continuation rows where ID and Name are blank", () => {
    const rows = [
      {
        ID: "1",
        Name: "Login flow",
        "Step Content": "Open page",
        "Expected Result": "Page loads",
      },
      {
        ID: "",
        Name: "",
        "Step Content": "Enter creds",
        "Expected Result": "Logged in",
      },
      {
        ID: "",
        Name: "",
        "Step Content": "Click Save",
        "Expected Result": "Saved",
      },
      {
        ID: "2",
        Name: "Logout flow",
        "Step Content": "Click logout",
        "Expected Result": "Out",
      },
      {
        ID: "",
        Name: "",
        "Step Content": "Confirm",
        "Expected Result": "Done",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]._aggregatedSteps).toHaveLength(3);
    expect(result[0]._aggregatedSteps.map((s: any) => s.step)).toEqual([
      "Open page",
      "Enter creds",
      "Click Save",
    ]);
    expect(result[1]._aggregatedSteps).toHaveLength(2);
    expect(result[1]._aggregatedSteps.map((s: any) => s.step)).toEqual([
      "Click logout",
      "Confirm",
    ]);
  });

  it("matches step columns by common aliases case-insensitively", () => {
    const rows = [
      { ID: "1", Name: "x", action: "Open page", expected: "Page loads" },
      { ID: "1", Name: "x", action: "Click save", expected: "Saved" },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]._aggregatedSteps).toHaveLength(2);
    expect(result[0]._aggregatedSteps[0].step).toBe("Open page");
    expect(result[0]._aggregatedSteps[0].expectedResult).toBe("Page loads");
  });

  it("honors a user mapping of templateField=steps as the step content column", () => {
    const rows = [
      { ID: "1", Title: "Login", Procedure: "Open page", Expected: "Loads" },
      { ID: "1", Title: "Login", Procedure: "Enter creds", Expected: "In" },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Title", templateField: "name" },
      { csvColumn: "Procedure", templateField: "steps" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]._aggregatedSteps).toHaveLength(2);
    expect(result[0]._aggregatedSteps[0].step).toBe("Open page");
    expect(result[0]._aggregatedSteps[0].expectedResult).toBe("Loads");
  });

  it("does not claim a column already mapped to a non-step template field", () => {
    // "Action" is in the step-content alias list, but it's been explicitly
    // mapped to a custom "description" field — leave it alone, no step
    // column is detected, return rows unchanged.
    const rows = [
      { ID: "1", Name: "Login", Action: "Authenticate user" },
      { ID: "2", Name: "Logout", Action: "Log out user" },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
      { csvColumn: "Action", templateField: "description" },
    ]);

    expect(result).toBe(rows);
  });

  it("returns input unchanged when no id or name mapping is provided", () => {
    const rows = [
      { Name: "a", "Step Content": "s1", "Expected Result": "" },
      { Name: "a", "Step Content": "s2", "Expected Result": "" },
    ];
    const result = aggregateMultiRowSteps(rows, []);
    expect(result).toBe(rows);
  });

  describe("inspectMultiRowAggregation", () => {
    it("reports detected columns and rows→cases counts", () => {
      const rows = [
        { ID: "1", Name: "x", "Step Content": "s1", "Expected Result": "" },
        { ID: "", Name: "", "Step Content": "s2", "Expected Result": "" },
        { ID: "2", Name: "y", "Step Content": "s3", "Expected Result": "" },
      ];

      const diag = inspectMultiRowAggregation(rows, [
        { csvColumn: "ID", templateField: "id" },
        { csvColumn: "Name", templateField: "name" },
      ]);

      expect(diag).toEqual({
        stepContentColumn: "Step Content",
        expectedResultColumn: "Expected Result",
        stepNumberColumn: null,
        idColumn: "ID",
        nameColumn: "Name",
        inputRows: 3,
        outputCases: 2,
      });
    });

    it("reports null step column when none is detected", () => {
      const rows = [{ ID: "1", Name: "x", Details: "..." }];
      const diag = inspectMultiRowAggregation(rows, [
        { csvColumn: "ID", templateField: "id" },
        { csvColumn: "Name", templateField: "name" },
      ]);
      expect(diag.stepContentColumn).toBeNull();
      expect(diag.expectedResultColumn).toBeNull();
      expect(diag.outputCases).toBe(diag.inputRows);
    });
  });

  it("uses row-order fallback when Step # is missing", () => {
    const rows = [
      {
        ID: "1",
        Name: "x",
        "Step Content": "First",
        "Expected Result": "",
      },
      {
        ID: "1",
        Name: "x",
        "Step Content": "Second",
        "Expected Result": "",
      },
    ];

    const result = aggregateMultiRowSteps(rows, [
      { csvColumn: "ID", templateField: "id" },
      { csvColumn: "Name", templateField: "name" },
    ]);

    expect(result[0]._aggregatedSteps).toEqual([
      { step: "First", expectedResult: "", order: 0 },
      { step: "Second", expectedResult: "", order: 1 },
    ]);
  });
});
