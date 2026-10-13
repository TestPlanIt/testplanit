import { describe, expect, it } from "vitest";
import {
  mergeRunMetadataIntoDoc,
  metadataKeyOf,
  runMetadataFromParams,
} from "./runMetadata";

const bold = (text: string) => ({
  type: "text",
  marks: [{ type: "bold" }],
  text,
});
const plain = (text: string) => ({ type: "text", text });
const para = (...content: unknown[]) => ({ type: "paragraph", content });

describe("mergeRunMetadataIntoDoc", () => {
  it("appends entries to an empty or absent doc", () => {
    const doc = mergeRunMetadataIntoDoc(null, { Browser: "edge" });
    expect(doc).toEqual({
      type: "doc",
      content: [para(bold("Browser: "), plain("edge"))],
    });
    expect(
      mergeRunMetadataIntoDoc(
        { type: "doc", content: [para()] },
        {
          Browser: "edge",
        }
      )
    ).toEqual(doc);
  });

  it("accepts the JSON-string shape and keeps surrounding text", () => {
    const existing = JSON.stringify({
      type: "doc",
      content: [
        para(plain("Nightly notes")),
        para(bold("Browser: "), plain("chrome")),
      ],
    });
    const doc = mergeRunMetadataIntoDoc(existing, {
      Browser: "edge",
      Tags: "smoke, regression",
    });
    expect(doc.content).toEqual([
      para(plain("Nightly notes")),
      para(bold("Browser: "), plain("edge")),
      para(bold("Tags: "), plain("smoke, regression")),
    ]);
  });

  it("omits the value node for an empty value and keeps non-JSON text", () => {
    const doc = mergeRunMetadataIntoDoc("free text", { Env: "" });
    expect(doc.content).toEqual([
      para(plain("free text")),
      para(bold("Env: ")),
    ]);
    expect(metadataKeyOf(para(bold("Env: ")))).toBe("Env");
    expect(metadataKeyOf(para(plain("Env: ")))).toBeNull();
  });
});

describe("runMetadataFromParams", () => {
  it("keys declared parameters by label and joins multiselect values", () => {
    expect(
      runMetadataFromParams([
        { name: "BROWSER", label: "Browser", values: ["edge"], declared: true },
        {
          name: "TAGS",
          label: "Tags",
          values: ["smoke", "regression"],
          declared: true,
        },
        {
          name: "FAIL_EVERY",
          label: "FAIL_EVERY",
          values: ["3"],
          declared: false,
        },
      ])
    ).toEqual({ Browser: "edge", Tags: "smoke, regression" });
  });
});
