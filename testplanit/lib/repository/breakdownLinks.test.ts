import { describe, expect, it } from "vitest";
import { repositoryBreakdownHref } from "./breakdownLinks";

describe("repositoryBreakdownHref", () => {
  it("views by automation, filtered on it, for the inner ring", () => {
    expect(repositoryBreakdownHref(7, { automated: true })).toBe(
      "/projects/repository/7?view=automated&f=automated:is:1"
    );
    expect(
      repositoryBreakdownHref(7, { automated: false, stateId: null })
    ).toBe("/projects/repository/7?view=automated&f=automated:is:0");
  });

  it("views by workflow state, with the state added, for the outer ring", () => {
    expect(repositoryBreakdownHref(7, { automated: false, stateId: 12 })).toBe(
      "/projects/repository/7?view=states&f=automated:is:0&f=states:in:12"
    );
  });
});
