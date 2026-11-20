/**
 * Reader for TestRail's test-suite XML export (root element `<suite>`).
 *
 * The format has no published schema. Custom field element names differ per
 * TestRail instance, so everything under `<custom>` is read as an open map.
 * Runs in the browser: it needs `DOMParser`.
 */

import { findTestRailVariables } from "./testRailVariables";

export interface TestRailStep {
  content: string;
  expected: string;
  additionalInfo: string;
}

export interface TestRailCase {
  id: string;
  title: string;
  template: string;
  type: string;
  priority: string;
  estimate: string;
  references: string;
  sectionPath: string[];
  /** Text of `custom/preconds`. */
  preconditions: string;
  /** Steps from either step layout; empty when the case has none. */
  steps: TestRailStep[];
  /** Every other field, keyed by its element name. */
  fields: Record<string, string>;
}

export interface TestRailSection {
  path: string[];
  description: string;
}

export interface TestRailSuite {
  id: string;
  name: string;
  description: string;
  sections: TestRailSection[];
  cases: TestRailCase[];
  /** TestRail template names with their case counts, most used first. */
  templates: { name: string; count: number }[];
  /** Field element names whose structure the reader did not recognize. */
  unrecognizedFields: string[];
}

export type TestRailXmlErrorCode = "invalid_xml" | "not_a_suite";

export class TestRailXmlError extends Error {
  constructor(public code: TestRailXmlErrorCode) {
    super(code);
    this.name = "TestRailXmlError";
  }
}

/** The name TestRail gives the suite of a single-suite project. */
export const TESTRAIL_DEFAULT_SUITE_NAME = "Master";

export const TESTRAIL_COLUMNS = {
  title: "Title",
  section: "Section",
  id: "TestRail ID",
  template: "TestRail Template",
  type: "Type",
  priority: "Priority",
  estimate: "Estimate",
  references: "References",
  preconditions: "Preconditions",
  steps: "Steps",
} as const;

const CASE_CORE_ELEMENTS = new Set([
  "id",
  "title",
  "template",
  "type",
  "priority",
  "estimate",
  "references",
  "custom",
]);

const childElements = (parent: Element, name?: string): Element[] =>
  Array.from(parent.children).filter(
    (child) => name === undefined || child.tagName === name
  );

const childElement = (parent: Element, name: string): Element | undefined =>
  childElements(parent, name)[0];

const childText = (parent: Element, name: string): string =>
  childElement(parent, name)?.textContent?.trim() ?? "";

/**
 * Whether the text is a TestRail suite export. Cheap enough to run on file
 * selection, to tell it apart from other XML.
 */
export function isTestRailSuiteXml(xml: string): boolean {
  return /^\s*(<\?xml[^>]*\?>)?\s*(<!--[\s\S]*?-->\s*)*<suite[\s>]/.test(xml);
}

/**
 * Reads a field element. Plain text comes back as is. A dropdown is written as
 * `<id>` + `<value>` and yields its value. Any other nested structure yields
 * its leaf texts joined by commas and is reported as unrecognized.
 */
function readFieldValue(element: Element, unrecognized: Set<string>): string {
  const children = childElements(element);
  if (children.length === 0) return element.textContent?.trim() ?? "";

  const names = children.map((child) => child.tagName);
  if (
    names.includes("value") &&
    names.every((name) => name === "id" || name === "value")
  ) {
    return childText(element, "value");
  }

  unrecognized.add(element.tagName);
  const leaves: string[] = [];
  const collect = (node: Element) => {
    const nested = childElements(node);
    if (nested.length === 0) {
      const text = node.textContent?.trim();
      // An <id> beside other values is TestRail's internal key, not content.
      if (text && node.tagName !== "id") leaves.push(text);
      return;
    }
    nested.forEach(collect);
  };
  collect(element);
  return leaves.join(", ");
}

const INLINE_EXPECTED =
  /^([\s\S]*?)\r?\n[ \t]*expected results?[ \t]*:[ \t]*\r?\n?([\s\S]*\S[\s\S]*)$/i;

/**
 * Some authors type the expected result into the step text, under a line
 * reading "Expected Result:", and leave the step's own expected field empty.
 * That text is moved to the expected result. A step that has an expected
 * result of its own is left as written.
 */
function splitInlineExpected(
  content: string,
  expected: string
): { content: string; expected: string } {
  if (expected) return { content, expected };
  const match = content.match(INLINE_EXPECTED);
  if (!match || !match[1].trim()) return { content, expected };
  return { content: match[1].trim(), expected: match[2].trim() };
}

function readCase(
  element: Element,
  sectionPath: string[],
  unrecognized: Set<string>
): TestRailCase {
  const testCase: TestRailCase = {
    id: childText(element, "id"),
    title: childText(element, "title"),
    template: childText(element, "template"),
    type: childText(element, "type"),
    priority: childText(element, "priority"),
    estimate: childText(element, "estimate"),
    references: childText(element, "references"),
    sectionPath,
    preconditions: "",
    steps: [],
    fields: {},
  };

  for (const child of childElements(element)) {
    if (CASE_CORE_ELEMENTS.has(child.tagName)) continue;
    const value = readFieldValue(child, unrecognized);
    if (value) testCase.fields[child.tagName] = value;
  }

  const custom = childElement(element, "custom");
  if (!custom) return testCase;

  let textSteps = "";
  let textExpected = "";
  for (const field of childElements(custom)) {
    switch (field.tagName) {
      case "preconds":
        testCase.preconditions = field.textContent?.trim() ?? "";
        break;
      case "steps":
        textSteps = field.textContent?.trim() ?? "";
        break;
      case "expected":
        textExpected = field.textContent?.trim() ?? "";
        break;
      case "steps_separated":
        testCase.steps = childElements(field, "step")
          .map((step, position) => ({
            index: parseInt(childText(step, "index")) || position + 1,
            content: childText(step, "content"),
            expected: childText(step, "expected"),
            additionalInfo: childText(step, "additional_info"),
          }))
          .sort((a, b) => a.index - b.index)
          .map(({ content, expected, additionalInfo }) => ({
            ...splitInlineExpected(content, expected),
            additionalInfo,
          }));
        break;
      default: {
        const value = readFieldValue(field, unrecognized);
        if (value) testCase.fields[field.tagName] = value;
      }
    }
  }

  // The text layout holds all steps in one field and all expected results in
  // another, so it becomes a single step.
  if (testCase.steps.length === 0 && (textSteps || textExpected)) {
    testCase.steps = [
      { content: textSteps, expected: textExpected, additionalInfo: "" },
    ];
  }

  return testCase;
}

function readSections(
  container: Element | undefined,
  parentPath: string[],
  suite: TestRailSuite,
  unrecognized: Set<string>
) {
  if (!container) return;
  for (const section of childElements(container, "section")) {
    const name = childText(section, "name");
    const path = name ? [...parentPath, name] : parentPath;
    if (name) {
      suite.sections.push({
        path,
        description: childText(section, "description"),
      });
    }
    const cases = childElement(section, "cases");
    if (cases) {
      for (const caseElement of childElements(cases, "case")) {
        suite.cases.push(readCase(caseElement, path, unrecognized));
      }
    }
    readSections(childElement(section, "sections"), path, suite, unrecognized);
  }
}

export function parseTestRailXml(xml: string): TestRailSuite {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new TestRailXmlError("invalid_xml");
  }
  const root = document.documentElement;
  if (!root || root.tagName !== "suite") {
    throw new TestRailXmlError("not_a_suite");
  }

  const suite: TestRailSuite = {
    id: childText(root, "id"),
    name: childText(root, "name"),
    description: childText(root, "description"),
    sections: [],
    cases: [],
    templates: [],
    unrecognizedFields: [],
  };
  const unrecognized = new Set<string>();
  readSections(childElement(root, "sections"), [], suite, unrecognized);

  const counts = new Map<string, number>();
  for (const testCase of suite.cases) {
    counts.set(testCase.template, (counts.get(testCase.template) ?? 0) + 1);
  }
  suite.templates = Array.from(counts, ([name, count]) => ({ name, count }))
    .filter((template) => template.name)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  suite.unrecognizedFields = Array.from(unrecognized).sort();

  return suite;
}

const ATTACHMENT_URL = String.raw`index\.php\?\/attachments\/get\/[\w-]+`;
const MARKDOWN_IMAGE = new RegExp(
  String.raw`!\[[^\]]*\]\([^)]*${ATTACHMENT_URL}[^)]*\)`,
  "g"
);
const HTML_IMAGE = new RegExp(
  String.raw`<img\b[^>]*${ATTACHMENT_URL}[^>]*>`,
  "gi"
);

/**
 * Replaces images that point at the TestRail instance with a text marker. The
 * export holds no image data, so the links cannot be followed after import.
 */
export function replaceTestRailImages(
  text: string,
  marker: string
): { text: string; count: number } {
  let count = 0;
  const replace = () => {
    count += 1;
    return marker;
  };
  const replaced = text
    .replace(MARKDOWN_IMAGE, replace)
    .replace(HTML_IMAGE, replace);
  return { text: replaced, count };
}

const splitTableRow = (line: string, prefix: string): string[] =>
  line
    .slice(prefix.length)
    .split("|")
    .map((cell) => cell.trim());

/**
 * Rewrites TestRail's table syntax (`|||:Head|:Head` then `|| cell | cell`)
 * as a standard markdown table.
 */
export function convertTestRailTables(text: string): string {
  if (!text.includes("|||")) return text;

  const output: string[] = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|||")) {
      const headers = splitTableRow(trimmed, "|||").map((cell) =>
        cell.replace(/^:/, "").trim()
      );
      // A markdown table needs a blank line before it.
      if (output.length > 0 && output[output.length - 1].trim() !== "") {
        output.push("");
      }
      output.push(`| ${headers.join(" | ")} |`);
      output.push(`| ${headers.map(() => "---").join(" | ")} |`);
      inTable = true;
    } else if (inTable && trimmed.startsWith("||")) {
      output.push(`| ${splitTableRow(trimmed, "||").join(" | ")} |`);
    } else {
      inTable = false;
      output.push(line);
    }
  }
  return output.join("\n");
}

const ESTIMATE_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  // TestRail counts a working day as 8 hours and a week as 5 days.
  d: 8 * 3600,
  w: 5 * 8 * 3600,
};

/**
 * Converts a TestRail timespan ("1h 30m", "45s", "90") to seconds. Returns
 * null for text it cannot read.
 */
export function parseTestRailEstimate(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseInt(text);

  const pattern =
    /(\d+(?:\.\d+)?)\s*(w|d|h|m|s)(?:eeks?|ays?|ours?|rs?|in(?:ute)?s?|ec(?:ond)?s?)?/g;
  let total = 0;
  let consumed = "";
  for (const match of text.matchAll(pattern)) {
    total += parseFloat(match[1]) * ESTIMATE_UNIT_SECONDS[match[2]];
    consumed += match[0];
  }
  const leftover = text.replace(pattern, "").replace(/[\s,]/g, "");
  if (!consumed || leftover) return null;
  return Math.round(total);
}

export interface TestRailImportOptions {
  /** Only cases of this TestRail template; null or undefined keeps all. */
  template?: string | null;
  /** Put every section under a new folder with this name. */
  suiteFolderName?: string | null;
  /** Text left where an image link was removed. */
  imageMarker: string;
}

export interface TestRailImportData {
  rows: Record<string, any>[];
  columns: string[];
  /** Descriptions of the sections the imported cases sit in or under. */
  folderDescriptions: { path: string[]; description: string }[];
  /** Image links replaced by the marker, over all imported cases. */
  imageCount: number;
  /** Cases whose estimate could not be read, by title. */
  unreadEstimates: string[];
  /** Imported cases whose steps use at least one TestRail variable. */
  casesWithVariables: number;
}

/**
 * Turns a parsed suite into the rows and column names the import wizard maps
 * to template fields. The folder cell is a list of names, so a section name
 * containing a path separator stays one folder.
 */
export function convertTestRailSuiteToImportData(
  suite: TestRailSuite,
  options: TestRailImportOptions
): TestRailImportData {
  const suiteFolderName = options.suiteFolderName?.trim();
  const prefix = suiteFolderName ? [suiteFolderName] : [];
  let imageCount = 0;
  const unreadEstimates: string[] = [];
  let casesWithVariables = 0;

  const clean = (text: string): string => {
    if (!text) return "";
    const { text: withoutImages, count } = replaceTestRailImages(
      text,
      options.imageMarker
    );
    imageCount += count;
    return convertTestRailTables(withoutImages).trim();
  };

  const cases = suite.cases.filter(
    (testCase) => !options.template || testCase.template === options.template
  );

  const used = new Set<string>();
  const fieldNames: string[] = [];
  const core = TESTRAIL_COLUMNS;
  const coreNames = new Set<string>(
    Object.values(core).map((name) => name.toLowerCase())
  );
  // A custom field may carry the name of one of the fixed columns.
  const fieldColumn = (name: string) =>
    coreNames.has(name.toLowerCase()) ? `${name} (custom)` : name;

  const rows = cases.map((testCase) => {
    const row: Record<string, any> = {};
    const set = (column: string, value: any) => {
      if (value === "" || value === null || value === undefined) return;
      row[column] = value;
      used.add(column);
    };

    set(core.title, testCase.title);
    const path = [...prefix, ...testCase.sectionPath];
    if (path.length > 0) set(core.section, path);
    set(core.id, testCase.id);
    set(core.template, testCase.template);
    set(core.type, testCase.type);
    set(core.priority, testCase.priority);

    if (testCase.estimate) {
      const seconds = parseTestRailEstimate(testCase.estimate);
      if (seconds === null) unreadEstimates.push(testCase.title);
      else set(core.estimate, String(seconds));
    }

    set(core.references, testCase.references);
    set(core.preconditions, clean(testCase.preconditions));

    const steps = testCase.steps
      .map((step) => {
        const content = clean(step.content);
        const additionalInfo = clean(step.additionalInfo);
        return {
          step:
            content && additionalInfo
              ? `${content}\n\n${additionalInfo}`
              : content || additionalInfo,
          expectedResult: clean(step.expected),
        };
      })
      .filter((step) => step.step || step.expectedResult);
    if (steps.length > 0) set(core.steps, JSON.stringify(steps));
    if (
      steps.some(
        (step) =>
          findTestRailVariables(step.step).length > 0 ||
          findTestRailVariables(step.expectedResult).length > 0
      )
    ) {
      casesWithVariables += 1;
    }

    for (const [name, value] of Object.entries(testCase.fields)) {
      const column = fieldColumn(name);
      if (!fieldNames.includes(column)) fieldNames.push(column);
      set(column, clean(value));
    }

    return row;
  });

  const columns = [...Object.values(core), ...fieldNames].filter((column) =>
    used.has(column)
  );

  const importedPaths = new Set(
    cases.map((testCase) => JSON.stringify(testCase.sectionPath))
  );
  const isImported = (path: string[]) =>
    Array.from(importedPaths).some((imported) => {
      const importedPath = JSON.parse(imported) as string[];
      return path.every((name, index) => importedPath[index] === name);
    });
  const folderDescriptions = suite.sections
    .filter((section) => section.description && isImported(section.path))
    .map((section) => ({
      path: [...prefix, ...section.path],
      description: clean(section.description),
    }));
  if (prefix.length > 0 && suite.description && cases.length > 0) {
    folderDescriptions.unshift({
      path: prefix,
      description: clean(suite.description),
    });
  }

  return {
    rows,
    columns,
    folderDescriptions,
    imageCount,
    unreadEstimates,
    casesWithVariables,
  };
}
