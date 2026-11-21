import { describe, expect, it } from "vitest";
import {
  buildQaseParameterSet,
  collectQaseImageUrls,
  convertQaseFieldValue,
  flattenQaseSteps,
  isEmptyDoc,
  qaseCaseFieldRawValues,
  qaseCaseStatuses,
  qaseSourceFields,
  qaseTextToDoc,
  type QaseFieldTarget,
} from "./content";
import type { QaseSourceField } from "./mapping";

const types = (doc: { content?: { type?: string }[] }) =>
  (doc.content ?? []).map((node) => node.type);

describe("qaseTextToDoc", () => {
  it("returns an empty document for blank text", () => {
    expect(isEmptyDoc(qaseTextToDoc(""))).toBe(true);
    expect(isEmptyDoc(qaseTextToDoc(null))).toBe(true);
  });

  it("keeps Markdown tables and places a copied image as an image node", () => {
    const text =
      "Intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![diagram](https://q.test/a.png)\n\nEnd";
    expect(collectQaseImageUrls(text)).toEqual(["https://q.test/a.png"]);
    const doc = qaseTextToDoc(text, (url) =>
      url === "https://q.test/a.png" ? "/api/storage/uploads/x.png" : null
    );
    expect(types(doc)).toEqual(["paragraph", "table", "image", "paragraph"]);
    expect(doc.content?.[2].attrs).toEqual({
      src: "/api/storage/uploads/x.png",
      alt: "diagram",
      align: "center",
    });
  });

  it("keeps the alternative text of an image that was not copied", () => {
    const doc = qaseTextToDoc("![shot](https://q.test/a.png)");
    expect(JSON.stringify(doc)).toContain('"text":"shot"');
    expect(JSON.stringify(doc)).not.toContain("QASEIMAGE");
  });

  it("finds images written as HTML", () => {
    expect(
      collectQaseImageUrls('<p>x</p><img alt="a" src="https://q.test/b.png">')
    ).toEqual(["https://q.test/b.png"]);
  });
});

describe("flattenQaseSteps", () => {
  it("puts nested steps after their parent and appends the input data", () => {
    const flat = flattenQaseSteps([
      { position: 2, action: "B", expected_result: "eb", steps: [] },
      {
        position: 1,
        action: "A",
        data: "d",
        steps: [
          {
            position: 1,
            action: "A1",
            steps: [{ position: 1, action: "A1a" }],
          },
        ],
      },
    ]);
    expect(
      flat.map((step) => (step.kind === "step" ? step.action : step.hash))
    ).toEqual(["A\n\n**Input data:** d", "A1", "A1a", "B"]);
  });

  it("collapses an expanded shared step into one entry", () => {
    const flat = flattenQaseSteps([
      { position: 1, shared_step_hash: "h1", action: "s1" },
      { position: 2, shared_step_hash: "h1", action: "s2" },
      { position: 3, action: "own" },
      { position: 4, shared_step_hash: "h1", action: "s1" },
    ]);
    expect(flat.map((step) => step.kind)).toEqual(["shared", "step", "shared"]);
  });

  it("turns a Gherkin scenario into one plain step", () => {
    expect(
      flattenQaseSteps([{ action: "Given a\nThen b" }], "gherkin")
    ).toEqual([
      {
        kind: "step",
        action: "Given a\nThen b",
        expected: "",
        plain: true,
        attachments: [],
      },
    ]);
  });
});

describe("source fields", () => {
  const system = [
    {
      slug: "priority",
      title: "Priority",
      options: [
        { id: 0, title: "Not set", slug: "undefined" },
        { id: 1, title: "High", slug: "high" },
      ],
    },
    { slug: "description", title: "Description" },
    {
      slug: "status",
      title: "Status",
      options: [{ id: 0, title: "Actual", slug: "actual" }],
    },
    { slug: "result_status", title: "Result status", options: [] },
  ];
  const custom = [
    {
      id: 1,
      title: "Browser",
      entity: "case",
      type: "selectbox",
      value: '[{"id":1,"title":"Chrome"}]',
      projects_codes: ["WEB"],
    },
    {
      id: 2,
      title: "Platforms",
      entity: "case",
      type: "Multiselect",
      is_enabled_for_all_projects: true,
      value: "[]",
    },
    {
      id: 3,
      title: "Other project",
      entity: "case",
      type: "string",
      projects_codes: ["API"],
    },
    {
      id: 4,
      title: "Build",
      entity: "run",
      type: "string",
      is_enabled_for_all_projects: true,
    },
    {
      id: 5,
      title: "Owner",
      entity: "case",
      type: "user",
      is_enabled_for_all_projects: true,
    },
  ];

  it("lists content system fields without their not-set option, then usable custom fields", () => {
    expect(qaseSourceFields(system, custom, ["WEB"])).toEqual([
      {
        key: "system:description",
        title: "Description",
        targetType: "Text Long",
        options: [],
      },
      {
        key: "system:priority",
        title: "Priority",
        targetType: "Dropdown",
        options: [{ id: "1", title: "High" }],
      },
      {
        key: "custom:1",
        title: "Browser",
        targetType: "Dropdown",
        options: [{ id: "1", title: "Chrome" }],
      },
      {
        key: "custom:2",
        title: "Platforms",
        targetType: "Multi-Select",
        options: [],
      },
    ]);
    expect(qaseCaseStatuses(system)).toEqual([{ id: "0", title: "Actual" }]);
  });
});

describe("convertQaseFieldValue", () => {
  const field = (
    targetType: QaseSourceField["targetType"]
  ): QaseSourceField => ({
    key: "custom:1",
    title: "F",
    targetType,
    options: [
      { id: "1", title: "Chrome" },
      { id: "2", title: "Firefox" },
    ],
  });
  const target = (type: QaseFieldTarget["type"]): QaseFieldTarget => ({
    type,
    optionIds: new Map([["chrome", 90]]),
  });

  it("maps options by name and reports the ones with no match", () => {
    expect(
      convertQaseFieldValue(field("Dropdown"), [1], target("Dropdown"))
    ).toEqual({ kind: "value", value: 90 });
    expect(
      convertQaseFieldValue(field("Dropdown"), ["2"], target("Dropdown"))
    ).toEqual({ kind: "unmatched", option: "Firefox" });
    expect(
      convertQaseFieldValue(field("Dropdown"), [0], target("Dropdown"))
    ).toEqual({ kind: "empty" });
    expect(
      convertQaseFieldValue(
        field("Multi-Select"),
        ["1", "2"],
        target("Multi-Select")
      )
    ).toEqual({ kind: "value", value: [90] });
    expect(
      convertQaseFieldValue(
        field("Multi-Select"),
        ["1,2"],
        target("Multi-Select")
      )
    ).toEqual({ kind: "value", value: [90] });
  });

  it("converts the scalar types", () => {
    expect(
      convertQaseFieldValue(field("Checkbox"), ["1"], target("Checkbox"))
    ).toEqual({ kind: "value", value: true });
    expect(
      convertQaseFieldValue(field("Checkbox"), [0], target("Checkbox"))
    ).toEqual({ kind: "value", value: false });
    expect(
      convertQaseFieldValue(field("Number"), ["5"], target("Number"))
    ).toEqual({ kind: "value", value: 5 });
    expect(
      convertQaseFieldValue(field("Number"), ["x"], target("Number"))
    ).toEqual({ kind: "empty" });
    expect(
      convertQaseFieldValue(field("Link"), ["javascript:1"], target("Link"))
    ).toEqual({ kind: "empty" });
    expect(
      convertQaseFieldValue(
        field("Date"),
        ["2026-12-01T15:00:00Z"],
        target("Date")
      )
    ).toEqual({ kind: "value", value: "2026-12-01T15:00:00.000Z" });
    expect(
      convertQaseFieldValue(field("Text String"), [], target("Text String"))
    ).toEqual({ kind: "empty" });
  });

  it("reads system and custom values off a case", () => {
    const record = {
      priority: 2,
      custom_fields: [
        { id: 2, value: "1" },
        { id: 2, value: "3" },
        { id: 4, value: "" },
      ],
    };
    expect(qaseCaseFieldRawValues(record, "system:priority")).toEqual([2]);
    expect(qaseCaseFieldRawValues(record, "custom:2")).toEqual(["1", "3"]);
    expect(qaseCaseFieldRawValues(record, "custom:4")).toEqual([]);
  });
});

describe("buildQaseParameterSet", () => {
  it("combines separate parameters and keeps a group's values together", () => {
    const set = buildQaseParameterSet([
      {
        type: "single",
        item: { title: "browser", values: ["chrome", "firefox"] },
      },
      {
        type: "group",
        items: [
          { title: "tier", values: ["free", "pro"] },
          { title: "seats", values: ["1", "25"] },
        ],
      },
    ]);
    expect(set.names).toEqual(["browser", "tier", "seats"]);
    expect(set.rows).toEqual([
      { browser: "chrome", tier: "free", seats: "1" },
      { browser: "chrome", tier: "pro", seats: "25" },
      { browser: "firefox", tier: "free", seats: "1" },
      { browser: "firefox", tier: "pro", seats: "25" },
    ]);
  });

  it("drops a repeated name and gives up on rows past the cap", () => {
    const many = Array.from({ length: 30 }, (_, index) => String(index));
    const set = buildQaseParameterSet([
      { item: { title: "a", values: many } },
      { item: { title: "a", values: ["x"] } },
      { item: { title: "b", values: many } },
    ]);
    expect(set).toEqual({ names: ["a", "b"], rows: [], truncated: true });
    expect(buildQaseParameterSet(null)).toEqual({
      names: [],
      rows: [],
      truncated: false,
    });
  });
});
