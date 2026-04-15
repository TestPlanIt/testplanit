import { lexer, type Token, type Tokens } from "marked";

// --- Types ---

export interface ParsedMarkdownStep {
  action: string;
  expectedResult?: string;
}

export interface ParsedMarkdownCase {
  name: string;
  description?: string;
  steps: ParsedMarkdownStep[];
  preconditions?: string;
  tags?: string[];
  folder?: string;
  [key: string]: any;
}

export interface MarkdownParseResult {
  cases: ParsedMarkdownCase[];
  format: "heading" | "table" | "single";
  detectedColumns: string[];
}

// --- Helpers ---

const KNOWN_SECTION_NAMES = new Set([
  "steps",
  "expected results",
  "expected result",
  "preconditions",
  "prerequisites",
  "pre-conditions",
  "description",
  "tags",
  "labels",
]);

function normalizeSectionName(name: string): string {
  return name.toLowerCase().trim();
}

function normalizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

const TEST_CASE_COLUMN_NAMES = new Set([
  "name",
  "title",
  "test case",
  "test case name",
  "steps",
  "step",
  "description",
  "expected result",
  "expected results",
  "preconditions",
  "prerequisites",
  "tags",
  "labels",
]);

function isTestCaseTable(table: Tokens.Table): boolean {
  const headers = table.header.map((h) => normalizeColumnName(h.text));
  return headers.some((h) => TEST_CASE_COLUMN_NAMES.has(h));
}

function tokensToRawMarkdown(tokens: Token[]): string {
  return tokens.map((t) => t.raw).join("");
}

/**
 * Split a token array into sections delimited by headings at a given depth.
 * Tokens before the first heading of that depth are returned as `preamble`.
 */
function splitByHeading(
  tokens: Token[],
  depth: number
): {
  preamble: Token[];
  sections: { heading: Tokens.Heading; tokens: Token[] }[];
} {
  const preamble: Token[] = [];
  const sections: { heading: Tokens.Heading; tokens: Token[] }[] = [];
  let current: { heading: Tokens.Heading; tokens: Token[] } | null = null;

  for (const token of tokens) {
    if (token.type === "heading" && (token as Tokens.Heading).depth === depth) {
      if (current) sections.push(current);
      current = { heading: token as Tokens.Heading, tokens: [] };
    } else if (current) {
      current.tokens.push(token);
    } else {
      preamble.push(token);
    }
  }
  if (current) sections.push(current);

  return { preamble, sections };
}

/**
 * Parse a single inline step text, trying `->` then `|` as separators.
 */
function parseInlineStep(text: string): ParsedMarkdownStep {
  const cleaned = text.replace(/^\s*(?:\d+[.)]\s*|[-*+]\s+)/, "").trim();

  // Try -> separator first
  const arrowIndex = cleaned.indexOf("->");
  if (arrowIndex > 0) {
    return {
      action: cleaned.substring(0, arrowIndex).trim(),
      expectedResult: cleaned.substring(arrowIndex + 2).trim(),
    };
  }

  // Try | separator (but not || which is logical OR / table-related)
  const pipeMatch = cleaned.match(/(?<!\|)\|(?!\|)/);
  if (pipeMatch && pipeMatch.index && pipeMatch.index > 0) {
    return {
      action: cleaned.substring(0, pipeMatch.index).trim(),
      expectedResult: cleaned.substring(pipeMatch.index + 1).trim(),
    };
  }

  return { action: cleaned };
}

/**
 * Parse steps from a list token or from raw text lines.
 */
function parseStepsFromTokens(tokens: Token[]): ParsedMarkdownStep[] {
  // Look for list tokens first
  const listToken = tokens.find((t) => t.type === "list") as
    | Tokens.List
    | undefined;

  if (listToken) {
    return listToken.items.map((item) => parseInlineStep(item.text));
  }

  // Fallback: parse paragraph/text content as lines
  const textContent = tokens
    .filter((t) => t.type === "paragraph" || t.type === "text")
    .map((t) => (t as Tokens.Paragraph | Tokens.Text).text)
    .join("\n");

  return parseInlineSteps(textContent);
}

/**
 * Parse multiple steps from a multi-line text string.
 */
function parseInlineSteps(text: string): ParsedMarkdownStep[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((line) => parseInlineStep(line));
}

/**
 * Merge separate expected results into an existing steps array by index.
 */
function mergeExpectedResults(
  steps: ParsedMarkdownStep[],
  expectedResultsText: string
): void {
  const lines = expectedResultsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^\s*(?:\d+[.)]\s*|[-*+]\s+)/, "").trim());

  lines.forEach((line, index) => {
    if (index < steps.length) {
      steps[index].expectedResult = line;
    }
  });
}

/**
 * Merge expected results parsed from tokens (list or text) into steps.
 */
function mergeExpectedResultsFromTokens(
  steps: ParsedMarkdownStep[],
  tokens: Token[]
): void {
  const listToken = tokens.find((t) => t.type === "list") as
    | Tokens.List
    | undefined;

  if (listToken) {
    listToken.items.forEach((item, index) => {
      if (index < steps.length) {
        steps[index].expectedResult = item.text.trim();
      }
    });
    return;
  }

  const text = tokens
    .filter((t) => t.type === "paragraph" || t.type === "text")
    .map((t) => (t as Tokens.Paragraph | Tokens.Text).text)
    .join("\n");

  mergeExpectedResults(steps, text);
}

/**
 * Parse a tags section from tokens (list items or comma-separated text).
 */
function parseTagsList(tokens: Token[]): string[] {
  const listToken = tokens.find((t) => t.type === "list") as
    | Tokens.List
    | undefined;
  if (listToken) {
    return listToken.items.map((item) => item.text.trim()).filter(Boolean);
  }

  const text = tokens
    .filter((t) => t.type === "paragraph" || t.type === "text")
    .map((t) => (t as Tokens.Paragraph | Tokens.Text).text)
    .join(", ");

  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Detect all unique "columns" (field names) present across parsed cases.
 */
function detectColumnsFromCases(cases: ParsedMarkdownCase[]): string[] {
  const columns = new Set<string>();
  columns.add("name");

  for (const c of cases) {
    if (c.description) columns.add("description");
    if (c.steps.length > 0) columns.add("steps");
    if (c.preconditions) columns.add("preconditions");
    if (c.tags && c.tags.length > 0) columns.add("tags");
    if (c.folder) columns.add("folder");

    for (const key of Object.keys(c)) {
      if (
        ![
          "name",
          "description",
          "steps",
          "preconditions",
          "tags",
          "folder",
        ].includes(key)
      ) {
        columns.add(key);
      }
    }
  }

  return Array.from(columns);
}

// --- Format Parsers ---

function parseTableFormat(table: Tokens.Table): MarkdownParseResult {
  const headers = table.header.map((cell) => cell.text.trim());

  const cases: ParsedMarkdownCase[] = table.rows.map((row) => {
    const caseData: ParsedMarkdownCase = { name: "", steps: [] };

    row.forEach((cell, colIndex) => {
      const normalized = normalizeColumnName(headers[colIndex]);
      const value = cell.text.trim();

      if (!value) return;

      switch (normalized) {
        case "name":
        case "title":
        case "test case":
        case "test case name":
          caseData.name = value;
          break;
        case "steps":
        case "step":
        case "test steps":
          caseData.steps = parseInlineSteps(value);
          break;
        case "expected result":
        case "expected results":
          mergeExpectedResults(caseData.steps, value);
          break;
        case "preconditions":
        case "prerequisites":
        case "precondition":
          caseData.preconditions = value;
          break;
        case "tags":
        case "labels":
          caseData.tags = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          break;
        case "description":
          caseData.description = value;
          break;
        default:
          // Store as-is for custom field mapping
          caseData[headers[colIndex]] = value;
      }
    });

    return caseData;
  });

  return {
    cases,
    format: "table",
    detectedColumns: headers.map((h) => {
      const n = normalizeColumnName(h);
      // Map known column aliases to canonical names
      if (n === "title" || n === "test case" || n === "test case name")
        return "name";
      if (n === "step" || n === "test steps") return "steps";
      if (n === "expected result") return "expected results";
      if (n === "precondition" || n === "prerequisites") return "preconditions";
      if (n === "labels") return "tags";
      return h;
    }),
  };
}

function parseHeadingFormat(
  tokens: Token[],
  topLevel: number
): MarkdownParseResult {
  const { sections } = splitByHeading(tokens, topLevel);

  const cases: ParsedMarkdownCase[] = sections.map((section) => {
    const name = section.heading.text;
    const caseData: ParsedMarkdownCase = { name, steps: [] };

    // Split sub-sections within this case
    const { preamble, sections: subSections } = splitByHeading(
      section.tokens,
      topLevel + 1
    );

    // Preamble (content before any sub-heading) = description
    const preambleText = tokensToRawMarkdown(
      preamble.filter((t) => t.type !== "space")
    ).trim();
    if (preambleText) {
      caseData.description = preambleText;
    }

    for (const sub of subSections) {
      const sectionName = normalizeSectionName(sub.heading.text);
      const contentTokens = sub.tokens.filter((t) => t.type !== "space");

      switch (sectionName) {
        case "steps":
        case "test steps":
          caseData.steps = parseStepsFromTokens(contentTokens);
          break;
        case "expected results":
        case "expected result":
          mergeExpectedResultsFromTokens(caseData.steps, contentTokens);
          break;
        case "preconditions":
        case "prerequisites":
        case "pre-conditions":
          caseData.preconditions = tokensToRawMarkdown(contentTokens).trim();
          break;
        case "tags":
        case "labels":
          caseData.tags = parseTagsList(contentTokens);
          break;
        case "description":
          caseData.description = tokensToRawMarkdown(contentTokens).trim();
          break;
        default:
          // Store custom sections by their heading text
          caseData[sub.heading.text] =
            tokensToRawMarkdown(contentTokens).trim();
      }
    }

    return caseData;
  });

  return {
    cases,
    format: "heading",
    detectedColumns: detectColumnsFromCases(cases),
  };
}

function parseSingleCaseFormat(tokens: Token[]): MarkdownParseResult {
  const caseData: ParsedMarkdownCase = { name: "", steps: [] };

  // Filter out space tokens
  const contentTokens = tokens.filter((t) => t.type !== "space");

  // Find headings to check for section structure
  const headings = contentTokens.filter(
    (t) => t.type === "heading"
  ) as Tokens.Heading[];

  if (headings.length > 0) {
    // Use the first heading as the name if it's not a known section heading
    const firstHeading = headings[0];
    const firstName = normalizeSectionName(firstHeading.text);
    if (!KNOWN_SECTION_NAMES.has(firstName)) {
      caseData.name = firstHeading.text;
    }

    // Split by the shallowest heading depth present
    const sectionLevel = Math.min(...headings.map((h) => h.depth));
    const { preamble, sections } = splitByHeading(contentTokens, sectionLevel);

    // Preamble before first section
    const preambleText = tokensToRawMarkdown(preamble).trim();
    if (preambleText && !caseData.name) {
      // If no name yet, use preamble as description
      caseData.description = preambleText;
    } else if (preambleText && caseData.name) {
      // Name came from first heading; preamble might be empty or just spaces
    }

    for (const section of sections) {
      const sectionName = normalizeSectionName(section.heading.text);
      const sectionTokens = section.tokens.filter((t) => t.type !== "space");

      // If the first heading became the name, skip re-processing it
      if (
        section.heading === firstHeading &&
        caseData.name === firstHeading.text
      ) {
        // Process content under the name heading as description
        const desc = tokensToRawMarkdown(sectionTokens).trim();
        if (desc) caseData.description = desc;
        continue;
      }

      switch (sectionName) {
        case "steps":
        case "test steps":
          caseData.steps = parseStepsFromTokens(sectionTokens);
          break;
        case "expected results":
        case "expected result":
          mergeExpectedResultsFromTokens(caseData.steps, sectionTokens);
          break;
        case "preconditions":
        case "prerequisites":
        case "pre-conditions":
          caseData.preconditions = tokensToRawMarkdown(sectionTokens).trim();
          break;
        case "tags":
        case "labels":
          caseData.tags = parseTagsList(sectionTokens);
          break;
        case "description":
          caseData.description = tokensToRawMarkdown(sectionTokens).trim();
          break;
        default:
          caseData[section.heading.text] =
            tokensToRawMarkdown(sectionTokens).trim();
      }
    }
  } else {
    // No headings at all - check if there's a list (steps) or just text (description)
    const listToken = contentTokens.find((t) => t.type === "list");
    if (listToken) {
      caseData.steps = parseStepsFromTokens(contentTokens);
    } else {
      caseData.description = tokensToRawMarkdown(contentTokens).trim();
    }
  }

  return {
    cases: [caseData],
    format: "single",
    detectedColumns: detectColumnsFromCases([caseData]),
  };
}

// --- Main Entry Point ---

/**
 * Parse a markdown string into structured test case data.
 *
 * Auto-detects the format:
 * 1. Table-based: markdown table with recognizable headers
 * 2. Heading-based: multiple top-level headings, each = one test case
 * 3. Single case: everything else
 */
export function parseMarkdownTestCases(markdown: string): MarkdownParseResult {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return { cases: [], format: "single", detectedColumns: [] };
  }

  const tokens = lexer(trimmed, { gfm: true });

  // 1. Check for table-based format
  const tableToken = tokens.find((t) => t.type === "table") as
    | Tokens.Table
    | undefined;
  if (tableToken && isTestCaseTable(tableToken)) {
    return parseTableFormat(tableToken);
  }

  // 2. Check for heading-based multi-case format
  const headings = tokens.filter(
    (t) => t.type === "heading"
  ) as Tokens.Heading[];

  if (headings.length > 0) {
    const topLevel = Math.min(...headings.map((h) => h.depth));
    const topHeadings = headings.filter((h) => h.depth === topLevel);

    // Check if there are sub-headings with known section names
    const hasKnownSections = headings.some(
      (h) =>
        h.depth > topLevel &&
        KNOWN_SECTION_NAMES.has(normalizeSectionName(h.text))
    );

    // If ALL top-level headings are known section names, treat as single case
    // e.g., "## Steps" + "## Expected Results" → not two test cases
    const allTopAreKnownSections = topHeadings.every((h) =>
      KNOWN_SECTION_NAMES.has(normalizeSectionName(h.text))
    );

    // Multi-case: multiple top-level headings that aren't all known section names
    if (topHeadings.length > 1 && !allTopAreKnownSections) {
      return parseHeadingFormat(tokens, topLevel);
    }

    // Single top-level heading with sub-sections → single case but structured
    if (topHeadings.length === 1 && hasKnownSections) {
      // Treat the single top heading as the case name, sub-sections as fields
      return parseHeadingFormat(tokens, topLevel);
    }

    // Headings exist but are all known section names (no case name heading)
    // e.g., ## Steps / ## Expected Results only
    if (
      topHeadings.every((h) =>
        KNOWN_SECTION_NAMES.has(normalizeSectionName(h.text))
      )
    ) {
      return parseSingleCaseFormat(tokens);
    }
  }

  // 3. Single case fallback
  return parseSingleCaseFormat(tokens);
}

// --- Conversion to Import Data ---

/**
 * Convert parsed markdown cases into the same row-based format used by the CSV import pipeline.
 * Each case becomes a flat object with column names as keys.
 */
export function convertMarkdownCasesToImportData(result: MarkdownParseResult): {
  rows: Record<string, any>[];
  columns: string[];
} {
  const columns = result.detectedColumns;

  const rows = result.cases.map((mc) => {
    const row: Record<string, any> = {};

    row["name"] = mc.name;

    if (mc.description) {
      row["description"] = mc.description;
    }

    if (mc.steps.length > 0) {
      // Convert to the pipe-separated format the backend already understands
      row["steps"] = mc.steps
        .map((s, i) => {
          const prefix = `${i + 1}. ${s.action}`;
          return s.expectedResult ? `${prefix} | ${s.expectedResult}` : prefix;
        })
        .join("\n");
    }

    if (mc.preconditions) {
      row["preconditions"] = mc.preconditions;
    }

    if (mc.tags && mc.tags.length > 0) {
      row["tags"] = mc.tags.join(", ");
    }

    if (mc.folder) {
      row["folder"] = mc.folder;
    }

    // Copy any custom fields
    for (const key of Object.keys(mc)) {
      if (
        ![
          "name",
          "description",
          "steps",
          "preconditions",
          "tags",
          "folder",
        ].includes(key)
      ) {
        row[key] = mc[key];
      }
    }

    return row;
  });

  return { rows, columns };
}
