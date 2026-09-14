import { describe, expect, it } from "vitest";
import en from "../../messages/en-US.json";
import { dimensionLabelKey, metricLabelKey } from "./reportLabelKeys";

const has = (path: string) =>
  path
    .split(".")
    .reduce<any>((o, k) => (o && k in o ? o[k] : undefined), en) !== undefined;

describe("report label keys", () => {
  it("points every Test Execution dimension at an existing message", () => {
    for (const id of [
      "status",
      "user",
      "configuration",
      "date",
      "testRun",
      "testCase",
      "milestone",
      "folder",
      "tag",
      "project",
    ]) {
      expect(has(dimensionLabelKey(id)), id).toBe(true);
    }
  });

  it("points every Test Execution metric at an existing message", () => {
    for (const id of [
      "testResults",
      "passRate",
      "avgElapsedTime",
      "totalElapsedTime",
      "testRunCount",
      "testCaseCount",
    ]) {
      expect(has(metricLabelKey(id)), id).toBe(true);
    }
  });
});
