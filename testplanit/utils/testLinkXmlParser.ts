/**
 * Reader for TestLink's test specification XML export: a test project or test
 * suite (root element `<testsuite>`) or the test cases of one suite (root
 * element `<testcases>`).
 *
 * The format has no published schema; the element names follow TestLink's
 * export code. Runs in the browser: it needs `DOMParser`.
 */

export interface TestLinkStep {
  actions: string;
  expected: string;
}

export interface TestLinkRequirement {
  docId: string;
  title: string;
  specTitle: string;
}

export interface TestLinkAttachment {
  name: string;
  mimeType: string;
  title: string;
  /** The file, base64-encoded as written in the export. */
  content: string;
}

export interface TestLinkCase {
  /** `fullexternalid` (with the project prefix) when present, else `externalid`. */
  externalId: string;
  name: string;
  version: string;
  summary: string;
  preconditions: string;
  /** TestLink's numeric codes, as written. Empty when the element is absent. */
  executionType: string;
  importance: string;
  status: string;
  /** Minutes, as written. */
  estimatedDuration: string;
  /** False only when the file marks the version inactive. */
  active: boolean;
  suitePath: string[];
  steps: TestLinkStep[];
  keywords: string[];
  platforms: string[];
  requirements: TestLinkRequirement[];
  customFields: Record<string, string>;
  attachments: TestLinkAttachment[];
}

export interface TestLinkSuite {
  path: string[];
  details: string;
}

export interface TestLinkSpec {
  suites: TestLinkSuite[];
  cases: TestLinkCase[];
  /** Files embedded in the export that are attached to test cases. */
  caseAttachmentCount: number;
  /** Files embedded in the export that are attached to test suites. */
  suiteAttachmentCount: number;
  /** Links between test cases. */
  relationCount: number;
}

export type TestLinkXmlErrorCode = "invalid_xml" | "not_testlink";

export class TestLinkXmlError extends Error {
  constructor(public code: TestLinkXmlErrorCode) {
    super(code);
    this.name = "TestLinkXmlError";
  }
}

export const TESTLINK_COLUMNS = {
  name: "Name",
  suite: "Test Suite",
  id: "TestLink ID",
  summary: "Summary",
  preconditions: "Preconditions",
  steps: "Steps",
  importance: "Importance",
  automated: "Automated",
  status: "Status",
  estimate: "Estimate",
  keywords: "Keywords",
  requirements: "Requirements",
  platforms: "Platforms",
  active: "Active",
  attachments: "Attachments",
} as const;

/** TestLink's own English labels for its numeric codes. */
export const TESTLINK_IMPORTANCE: Record<string, string> = {
  "1": "Low",
  "2": "Medium",
  "3": "High",
};

export const TESTLINK_STATUS: Record<string, string> = {
  "1": "Draft",
  "2": "Ready for review",
  "3": "Review in progress",
  "4": "Rework",
  "5": "Obsolete",
  "6": "Future",
  "7": "Final",
};

const EXECUTION_TYPE_AUTOMATED = "2";

const childElements = (parent: Element, name?: string): Element[] =>
  Array.from(parent.children).filter(
    (child) => name === undefined || child.tagName === name
  );

const childElement = (parent: Element, name: string): Element | undefined =>
  childElements(parent, name)[0];

const childText = (parent: Element, name: string): string =>
  childElement(parent, name)?.textContent?.trim() ?? "";

const ROOT_PATTERN =
  /^\s*(<\?xml[^>]*\?>)?\s*(<!--[\s\S]*?-->\s*)*<(testsuite|testcases)[\s>/]/;

/**
 * Whether the text is a TestLink test specification export. Cheap enough to
 * run on file selection, to tell it apart from other XML. JUnit result files
 * share the `<testsuite>` root; they carry counters as attributes, which
 * TestLink never writes.
 */
export function isTestLinkXml(xml: string): boolean {
  if (!ROOT_PATTERN.test(xml)) return false;
  const rootTag = xml.slice(xml.search(/<(testsuite|testcases)[\s>/]/));
  const attributes = rootTag.slice(0, rootTag.indexOf(">"));
  return !/\s(tests|failures|errors)\s*=/.test(attributes);
}

function readSteps(element: Element): TestLinkStep[] {
  const container = childElement(element, "steps");
  if (!container) return [];

  const stepElements = childElements(container, "step");
  if (stepElements.length > 0) {
    return stepElements
      .map((step, position) => ({
        number: parseInt(childText(step, "step_number")) || position + 1,
        actions: childText(step, "actions"),
        expected: childText(step, "expectedresults"),
      }))
      .sort((a, b) => a.number - b.number)
      .map(({ actions, expected }) => ({ actions, expected }))
      .filter((step) => step.actions || step.expected);
  }

  // Before TestLink 1.9 a case held all steps in one text and all expected
  // results in another, so it becomes a single step.
  const actions = container.textContent?.trim() ?? "";
  const expected = childText(element, "expectedresults");
  return actions || expected ? [{ actions, expected }] : [];
}

function readCase(element: Element, suitePath: string[]): TestLinkCase {
  const customFields: Record<string, string> = {};
  const customFieldsElement = childElement(element, "custom_fields");
  if (customFieldsElement) {
    for (const field of childElements(customFieldsElement, "custom_field")) {
      const name = childText(field, "name");
      const value = childText(field, "value");
      if (name && value) customFields[name] = value;
    }
  }

  const listOf = <T>(
    container: string,
    item: string,
    read: (element: Element) => T
  ): T[] => {
    const parent = childElement(element, container);
    return parent ? childElements(parent, item).map(read) : [];
  };

  return {
    externalId:
      childText(element, "fullexternalid") || childText(element, "externalid"),
    name: element.getAttribute("name")?.trim() ?? "",
    version: childText(element, "version"),
    summary: childText(element, "summary"),
    preconditions: childText(element, "preconditions"),
    // Exports before 1.9.4 wrote the element without the underscore.
    executionType:
      childText(element, "execution_type") ||
      childText(element, "executiontype"),
    importance: childText(element, "importance"),
    status: childText(element, "status"),
    estimatedDuration: childText(element, "estimated_exec_duration"),
    active: childText(element, "active") !== "0",
    suitePath,
    steps: readSteps(element),
    keywords: listOf(
      "keywords",
      "keyword",
      (keyword) => keyword.getAttribute("name")?.trim() ?? ""
    ).filter((name) => name),
    platforms: listOf("platforms", "platform", (platform) =>
      childText(platform, "name")
    ).filter((name) => name),
    requirements: listOf("requirements", "requirement", (requirement) => ({
      docId: childText(requirement, "doc_id"),
      title: childText(requirement, "title"),
      specTitle: childText(requirement, "req_spec_title"),
    })).filter((requirement) => requirement.docId || requirement.title),
    customFields,
    attachments: listOf("attachments", "attachment", (attachment) => ({
      name: childText(attachment, "name"),
      mimeType: childText(attachment, "file_type"),
      title: childText(attachment, "title"),
      content: childText(attachment, "content"),
    })).filter((attachment) => attachment.name && attachment.content),
  };
}

function readContainer(container: Element, path: string[], spec: TestLinkSpec) {
  for (const child of childElements(container)) {
    switch (child.tagName) {
      case "testcase":
        spec.cases.push(readCase(child, path));
        break;
      case "testsuite": {
        // A whole-project export wraps everything in a suite without a name.
        const name = child.getAttribute("name")?.trim() ?? "";
        const suitePath = name ? [...path, name] : path;
        if (name) {
          spec.suites.push({
            path: suitePath,
            details: childText(child, "details"),
          });
        }
        readContainer(child, suitePath, spec);
        break;
      }
      case "attachments":
        spec.suiteAttachmentCount += childElements(child, "attachment").length;
        break;
      case "relation":
        spec.relationCount += 1;
        break;
    }
  }
}

export function parseTestLinkXml(xml: string): TestLinkSpec {
  // TestLink never writes a document type; one can only carry entity
  // definitions, which have no place in an uploaded file.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new TestLinkXmlError("invalid_xml");
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new TestLinkXmlError("invalid_xml");
  }
  const root = document.documentElement;
  if (
    !root ||
    (root.tagName !== "testsuite" && root.tagName !== "testcases") ||
    !isTestLinkXml(xml)
  ) {
    throw new TestLinkXmlError("not_testlink");
  }

  const spec: TestLinkSpec = {
    suites: [],
    cases: [],
    caseAttachmentCount: 0,
    suiteAttachmentCount: 0,
    relationCount: 0,
  };

  if (root.tagName === "testcases") {
    readContainer(root, [], spec);
  } else {
    // Reading from a wrapper treats the root suite like any nested one.
    const wrapper = document.createElement("wrapper");
    wrapper.appendChild(root.cloneNode(true));
    readContainer(wrapper, [], spec);
  }

  spec.caseAttachmentCount = spec.cases.reduce(
    (total, testCase) => total + testCase.attachments.length,
    0
  );
  return spec;
}

/**
 * Converts TestLink's estimated execution duration, written in minutes and
 * possibly fractional, to seconds. Returns null for text it cannot read.
 */
export function parseTestLinkDuration(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.round(parseFloat(text) * 60);
}

/** Decodes an embedded attachment. Throws when its content is not base64. */
export function testLinkAttachmentToFile(attachment: TestLinkAttachment): File {
  const binary = atob(attachment.content.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], attachment.name, {
    type: attachment.mimeType || "application/octet-stream",
  });
}

export interface TestLinkImportData {
  rows: Record<string, any>[];
  columns: string[];
  /** The embedded files of each row's test case, in row order. */
  attachments: TestLinkAttachment[][];
  /** Details of the suites the cases sit in or under. */
  folderDescriptions: { path: string[]; description: string }[];
  /** Cases whose estimated duration could not be read. */
  unreadEstimates: number;
}

/**
 * Turns a parsed specification into the rows and column names the import
 * wizard maps to template fields. The folder cell is a list of names, so a
 * suite name containing a path separator stays one folder.
 */
export function convertTestLinkSpecToImportData(
  spec: TestLinkSpec
): TestLinkImportData {
  const core = TESTLINK_COLUMNS;
  const coreNames = new Set<string>(
    Object.values(core).map((name) => name.toLowerCase())
  );
  // A custom field may carry the name of one of the fixed columns.
  const fieldColumn = (name: string) =>
    coreNames.has(name.toLowerCase()) ? `${name} (custom)` : name;

  const used = new Set<string>();
  const fieldNames: string[] = [];
  let unreadEstimates = 0;
  const hasInactive = spec.cases.some((testCase) => !testCase.active);
  // Tags are read as a comma-separated list unless the cell is a JSON list.
  const joinNames = (names: string[]) =>
    names.some((name) => name.includes(","))
      ? JSON.stringify(names)
      : names.join(", ");

  const rows = spec.cases.map((testCase) => {
    const row: Record<string, any> = {};
    const set = (column: string, value: any) => {
      if (value === "" || value === null || value === undefined) return;
      row[column] = value;
      used.add(column);
    };

    set(core.name, testCase.name);
    if (testCase.suitePath.length > 0) set(core.suite, testCase.suitePath);
    set(core.id, testCase.externalId);
    set(core.summary, testCase.summary);
    set(core.preconditions, testCase.preconditions);
    // The cell lists the file names; the wizard uploads the files and puts
    // their addresses here when the column is mapped.
    if (testCase.attachments.length > 0) {
      set(
        core.attachments,
        testCase.attachments.map((attachment) => attachment.name).join(", ")
      );
    }

    const steps = testCase.steps.map((step) => ({
      step: step.actions,
      expectedResult: step.expected,
    }));
    if (steps.length > 0) set(core.steps, JSON.stringify(steps));

    set(
      core.importance,
      TESTLINK_IMPORTANCE[testCase.importance] ?? testCase.importance
    );
    if (testCase.executionType) {
      set(
        core.automated,
        testCase.executionType === EXECUTION_TYPE_AUTOMATED ? "Yes" : "No"
      );
    }
    set(core.status, TESTLINK_STATUS[testCase.status] ?? testCase.status);

    if (testCase.estimatedDuration) {
      const seconds = parseTestLinkDuration(testCase.estimatedDuration);
      if (seconds === null) unreadEstimates += 1;
      else set(core.estimate, String(seconds));
    }

    if (testCase.keywords.length > 0) {
      set(core.keywords, joinNames(testCase.keywords));
    }
    if (testCase.requirements.length > 0) {
      set(
        core.requirements,
        testCase.requirements
          .map((requirement) => requirement.docId || requirement.title)
          .join(", ")
      );
    }
    if (testCase.platforms.length > 0) {
      set(core.platforms, testCase.platforms.join(", "));
    }
    if (hasInactive) set(core.active, testCase.active ? "Yes" : "No");

    for (const [name, value] of Object.entries(testCase.customFields)) {
      const column = fieldColumn(name);
      if (!fieldNames.includes(column)) fieldNames.push(column);
      set(column, value);
    }

    return row;
  });

  const columns = [...Object.values(core), ...fieldNames].filter((column) =>
    used.has(column)
  );

  const casePaths = spec.cases.map((testCase) => testCase.suitePath);
  const holdsCases = (path: string[]) =>
    casePaths.some((casePath) =>
      path.every((name, index) => casePath[index] === name)
    );
  const folderDescriptions = spec.suites
    .filter((suite) => suite.details && holdsCases(suite.path))
    .map((suite) => ({ path: suite.path, description: suite.details }));

  return {
    rows,
    columns,
    attachments: spec.cases.map((testCase) => testCase.attachments),
    folderDescriptions,
    unreadEstimates,
  };
}
