import { describe, expect, it } from "vitest";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";
import {
  convertTestRailVariables,
  findTestRailVariables,
} from "./testRailVariables";

const chip = (name: string) => ({
  type: "parameterMention",
  attrs: { id: name, label: name, paramType: "STRING" },
});

describe("findTestRailVariables", () => {
  it("finds each variable once, in order of first use", () => {
    expect(
      findTestRailVariables("Log in as %user% with %pass_word%, then %user%")
    ).toEqual(["user", "pass_word"]);
  });

  it("ignores percent signs that do not wrap a name", () => {
    expect(findTestRailVariables("%Var3 and 50% of 100% and %%")).toEqual([]);
  });
});

describe("convertTestRailVariables", () => {
  it("replaces variables with parameter chips and keeps the text around them", () => {
    const { doc, names } = convertTestRailVariables(
      ensureTipTapJSON("Two variables: %Var1% and %Var2% here")
    );
    expect(names).toEqual(["Var1", "Var2"]);
    expect(doc.content?.[0].content).toEqual([
      { type: "text", text: "Two variables: " },
      chip("Var1"),
      { type: "text", text: " and " },
      chip("Var2"),
      { type: "text", text: " here" },
    ]);
  });

  it("keeps the formatting of the text it splits", () => {
    const { doc } = convertTestRailVariables(
      ensureTipTapJSON("Use **bold %name% text** now")
    );
    const bold = [{ type: "bold" }];
    expect(doc.content?.[0].content).toEqual([
      { type: "text", text: "Use " },
      { type: "text", text: "bold ", marks: bold },
      chip("name"),
      { type: "text", text: " text", marks: bold },
      { type: "text", text: " now" },
    ]);
  });

  it("finds variables inside lists and tables", () => {
    const { names } = convertTestRailVariables(
      ensureTipTapJSON("- item %a%\n\n| h |\n| --- |\n| %b% |")
    );
    expect(names).toEqual(["a", "b"]);
  });

  it("leaves code and text without variables as written", () => {
    const source = ensureTipTapJSON("Run `echo %PATH%` at 50% load");
    const { doc, names } = convertTestRailVariables(source);
    expect(names).toEqual([]);
    expect(doc).toEqual(source);
  });
});
