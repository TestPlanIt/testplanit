import { describe, expect, it } from "vitest";
import { aggregateMultiRowSteps } from "./aggregateMultiRowSteps";

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
