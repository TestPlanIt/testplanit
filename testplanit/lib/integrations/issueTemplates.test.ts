import { describe, expect, it } from "vitest";
import {
  initialIssueFormValues,
  missingIssueFormFields,
  renderIssueFormBody,
  type IssueFormElement,
} from "./issueTemplates";

const form: IssueFormElement[] = [
  { kind: "markdown", text: "Thanks." },
  { kind: "input", id: "summary", label: "Summary", required: true },
  {
    kind: "textarea",
    id: "details",
    label: "Details",
    value: "Context:",
    render: "text",
    required: false,
  },
  {
    kind: "dropdown",
    id: "area",
    label: "Area",
    options: ["API", "Web UI"],
    multiple: false,
    defaultIndex: 1,
    required: true,
  },
  {
    kind: "dropdown",
    id: "browsers",
    label: "Browsers",
    options: ["Chrome", "Firefox"],
    multiple: true,
    required: false,
  },
  {
    kind: "checkboxes",
    id: "terms",
    label: "Checks",
    options: [
      { label: "I searched first", required: true },
      { label: "I can help test", required: false },
    ],
  },
];

describe("issue form helpers", () => {
  it("starts each field on its preset value", () => {
    expect(initialIssueFormValues(form)).toEqual({
      summary: "",
      details: "Context:",
      area: "Web UI",
      browsers: [],
      terms: [],
    });
  });

  it("names the required fields that have no answer", () => {
    expect(missingIssueFormFields(form, initialIssueFormValues(form))).toEqual([
      "summary",
      "terms",
    ]);
    expect(
      missingIssueFormFields(form, {
        summary: "  ",
        area: "",
        browsers: [],
        terms: ["I can help test"],
      })
    ).toEqual(["summary", "area", "terms"]);
    expect(
      missingIssueFormFields(form, {
        summary: "Dark mode",
        area: "API",
        browsers: [],
        terms: ["I searched first"],
      })
    ).toEqual([]);
  });

  it("writes the body GitHub writes for a submitted form", () => {
    expect(
      renderIssueFormBody(form, {
        summary: "Dark mode",
        details: "Context:\nnight shifts",
        area: "Web UI",
        browsers: ["Chrome", "Firefox"],
        terms: ["I searched first"],
      })
    ).toBe(
      [
        "### Summary\n\nDark mode",
        "### Details\n\n```text\nContext:\nnight shifts\n```",
        "### Area\n\nWeb UI",
        "### Browsers\n\nChrome, Firefox",
        "### Checks\n\n- [X] I searched first\n- [ ] I can help test",
      ].join("\n\n")
    );
  });

  it("marks an unanswered field as having no response", () => {
    expect(
      renderIssueFormBody(form, { summary: "", details: " ", browsers: [] })
    ).toBe(
      [
        "### Summary\n\n_No response_",
        "### Details\n\n_No response_",
        "### Area\n\n_No response_",
        "### Browsers\n\n_No response_",
        "### Checks\n\n- [ ] I searched first\n- [ ] I can help test",
      ].join("\n\n")
    );
  });
});
