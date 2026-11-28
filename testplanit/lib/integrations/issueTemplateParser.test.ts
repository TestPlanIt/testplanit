import { describe, expect, it } from "vitest";
import { parseIssueTemplates } from "./issueTemplateParser";

const markdownTemplate = `---
name: Bug report
about: Report something that does not work
title: "[Bug]: "
labels: bug, help wanted
assignees: alice
type: Bug
---

## What happened

Describe the problem.
`;

const issueForm = `name: Feature request
description: Suggest an idea
title: "[Feature]: "
labels: ["enhancement"]
assignees:
  - alice
  - bob
type: Feature
body:
  - type: markdown
    attributes:
      value: Thanks for the idea.
  - type: input
    id: summary
    attributes:
      label: Summary
      description: One line.
      placeholder: A short summary
    validations:
      required: true
  - type: textarea
    id: details
    attributes:
      label: Details
      value: "Context:"
      render: text
  - type: dropdown
    id: area
    attributes:
      label: Area
      options: [API, Web UI]
      default: 1
    validations:
      required: true
  - type: dropdown
    attributes:
      label: Browsers
      multiple: true
      options: [Chrome, Firefox]
  - type: checkboxes
    id: terms
    attributes:
      label: Checks
      options:
        - label: I searched first
          required: true
        - label: I can help test
  - type: upload
    id: files
    attributes:
      label: Files
`;

describe("parseIssueTemplates", () => {
  it("reads a markdown template's front matter and starting body", () => {
    const { templates } = parseIssueTemplates([
      { name: "bug_report.md", text: markdownTemplate },
    ]);

    expect(templates).toEqual([
      {
        id: "bug_report.md",
        name: "Bug report",
        description: "Report something that does not work",
        title: "[Bug]: ",
        labels: ["bug", "help wanted"],
        assignees: ["alice"],
        issueType: "Bug",
        body: "## What happened\n\nDescribe the problem.\n",
      },
    ]);
  });

  it("reads an issue form's fields in order and leaves out kinds it cannot offer", () => {
    const { templates } = parseIssueTemplates([
      { name: "feature_request.yml", text: issueForm },
    ]);

    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: "feature_request.yml",
      name: "Feature request",
      description: "Suggest an idea",
      title: "[Feature]: ",
      labels: ["enhancement"],
      assignees: ["alice", "bob"],
      issueType: "Feature",
    });
    expect(templates[0].body).toBeUndefined();
    expect(templates[0].form).toEqual([
      { kind: "markdown", text: "Thanks for the idea." },
      {
        kind: "input",
        id: "summary",
        label: "Summary",
        description: "One line.",
        placeholder: "A short summary",
        value: undefined,
        render: undefined,
        required: true,
      },
      {
        kind: "textarea",
        id: "details",
        label: "Details",
        description: undefined,
        placeholder: undefined,
        value: "Context:",
        render: "text",
        required: false,
      },
      {
        kind: "dropdown",
        id: "area",
        label: "Area",
        description: undefined,
        options: ["API", "Web UI"],
        multiple: false,
        defaultIndex: 1,
        required: true,
      },
      {
        kind: "dropdown",
        id: "field-4",
        label: "Browsers",
        description: undefined,
        options: ["Chrome", "Firefox"],
        multiple: true,
        defaultIndex: undefined,
        required: false,
      },
      {
        kind: "checkboxes",
        id: "terms",
        label: "Checks",
        description: undefined,
        options: [
          { label: "I searched first", required: true },
          { label: "I can help test", required: false },
        ],
      },
    ]);
  });

  it("lists templates by file name and reads whether blank issues are allowed", () => {
    const set = parseIssueTemplates([
      { name: "feature_request.yml", text: issueForm },
      { name: "config.yml", text: "blank_issues_enabled: false\n" },
      { name: "bug_report.md", text: markdownTemplate },
    ]);

    expect(set.blankIssuesEnabled).toBe(false);
    expect(set.templates.map((template) => template.id)).toEqual([
      "bug_report.md",
      "feature_request.yml",
    ]);
  });

  it("allows blank issues unless the config turns them off", () => {
    expect(parseIssueTemplates([]).blankIssuesEnabled).toBe(true);
    expect(
      parseIssueTemplates([{ name: "config.yml", text: "contact_links: []" }])
        .blankIssuesEnabled
    ).toBe(true);
  });

  it("treats a markdown file without front matter as a template named after the file", () => {
    const { templates } = parseIssueTemplates([
      { name: "plain.md", text: "Just describe it.\n" },
    ]);

    expect(templates).toEqual([
      {
        id: "plain.md",
        name: "plain.md",
        description: undefined,
        title: undefined,
        labels: [],
        assignees: [],
        issueType: undefined,
        body: "Just describe it.\n",
      },
    ]);
  });

  it("leaves out files that are not templates or cannot be read", () => {
    const { templates } = parseIssueTemplates([
      { name: "broken.yml", text: "name: [unterminated" },
      { name: "no-body.yml", text: "name: Not a form\n" },
      { name: "binary.md", text: null },
      { name: "notes.txt", text: "ignored" },
    ]);

    expect(templates).toEqual([]);
  });
});
