import { describe, it, expect } from "vitest";

import { adaptTestSteps } from "./automationStepAdapter";
import type { ITestStep } from "test-results-parser";

/** Build an ITestStep fixture with all required fields. */
const step = (name: string): ITestStep => ({
  name,
  duration: 0,
  status: "PASS",
  failure: "",
  stack_trace: "",
});

describe("adaptTestSteps", () => {
  it("maps Given/When/Then to precondition/action/assertion with the keyword stripped", () => {
    const input = [
      step("Given I am on the login page"),
      step("When I click sign in"),
      step("Then I see the dashboard"),
    ];
    expect(adaptTestSteps(input, "cucumber")).toEqual([
      { title: "I am on the login page", kind: "precondition" },
      { title: "I click sign in", kind: "action" },
      { title: "I see the dashboard", kind: "assertion" },
    ]);
  });

  it("inherits the prior primary kind for `And` after `When`", () => {
    const input = [
      step("When I fill in the form"),
      step("And I submit it"),
    ];
    expect(adaptTestSteps(input, "cucumber")).toEqual([
      { title: "I fill in the form", kind: "action" },
      { title: "I submit it", kind: "action" },
    ]);
  });

  it("inherits the prior primary kind for `But` after `Then`", () => {
    const input = [
      step("Then I see a success message"),
      step("But I do not see an error"),
    ];
    expect(adaptTestSteps(input, "cucumber")).toEqual([
      { title: "I see a success message", kind: "assertion" },
      { title: "I do not see an error", kind: "assertion" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(adaptTestSteps([], "cucumber")).toEqual([]);
  });

  it("returns [] for a stepless format (graceful-skip)", () => {
    expect(adaptTestSteps([], "junit")).toEqual([]);
  });

  it("falls through to a plain action step when no Gherkin keyword is present", () => {
    expect(adaptTestSteps([step("login user")], "junit")).toEqual([
      { title: "login user", kind: "action" },
    ]);
  });
});
