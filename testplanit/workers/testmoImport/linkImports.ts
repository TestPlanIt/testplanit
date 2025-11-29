import { Prisma } from "@prisma/client";
import { getSchema } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Window as HappyDOMWindow } from "happy-dom";
import type { TestmoMappingConfiguration } from "../../services/imports/testmo/types";
import { toInputJsonValue, toNumberValue, toStringValue } from "./helpers";
import type { EntitySummaryResult, ImportContext } from "./types";

/**
 * Convert link data to TipTap JSON format
 */
const TIPTAP_EXTENSIONS = [
  StarterKit.configure({
    dropcursor: false,
    gapcursor: false,
    undoRedo: false,
    trailingNode: false,
    heading: {
      levels: [1, 2, 3, 4],
    },
  }),
];

const TIPTAP_SCHEMA = getSchema(TIPTAP_EXTENSIONS);

let sharedHappyDOMWindow: HappyDOMWindow | null = null;
let sharedDOMParser: any = null; // Happy-DOM parser has a custom type

const getSharedHappyDOM = () => {
  if (!sharedHappyDOMWindow || !sharedDOMParser) {
    if (sharedHappyDOMWindow) {
      try {
        sharedHappyDOMWindow.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    sharedHappyDOMWindow = new HappyDOMWindow();
    sharedDOMParser = new sharedHappyDOMWindow.DOMParser();
  }

  return { window: sharedHappyDOMWindow!, parser: sharedDOMParser! };
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttribute = (value: string): string =>
  escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const buildLinkHtml = (
  name: string,
  url: string,
  note?: string | null
): string => {
  const safeLabel = escapeHtml(name);
  const safeUrl = escapeAttribute(url);
  const noteFragment = note ? ` (${escapeHtml(note)})` : "";
  return `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>${noteFragment}</p>`;
};

const convertHtmlToTipTapDoc = (html: string): Record<string, unknown> => {
  const { parser } = getSharedHappyDOM();
  if (!parser) {
    throw new Error("Failed to initialize DOM parser");
  }
  const htmlString = `<!DOCTYPE html><html><body>${html}</body></html>`;
  const document = parser.parseFromString(htmlString, "text/html");
  if (!document?.body) {
    throw new Error("Failed to parse HTML content for TipTap conversion");
  }

  return PMDOMParser.fromSchema(TIPTAP_SCHEMA).parse(document.body).toJSON();
};

const sanitizeLinkMarks = (node: Record<string, any>) => {
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark?.type === "link" && mark.attrs) {
        const { href, target } = mark.attrs;
        mark.attrs = {
          href,
          ...(target ? { target } : {}),
        };
      }
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === "object") {
        sanitizeLinkMarks(child as Record<string, any>);
      }
    }
  }
};

function createTipTapLink(
  name: string,
  url: string,
  note?: string | null
): Record<string, unknown> {
  try {
    const html = buildLinkHtml(name, url, note);
    const doc = convertHtmlToTipTapDoc(html);
    if (doc && Array.isArray(doc.content) && doc.content.length > 0) {
      for (const node of doc.content) {
        if (node && typeof node === "object") {
          sanitizeLinkMarks(node as Record<string, any>);
        }
      }
      // Each html snippet is wrapped in a doc node. Return the paragraph node.
      return doc.content[0];
    }
  } catch (error) {
    // Fallback to direct JSON construction if HTML conversion fails
  }

  const linkContent: any[] = [
    {
      type: "text",
      marks: [
        {
          type: "link",
          attrs: {
            href: url,
            target: "_blank",
          },
        },
      ],
      text: name,
    },
  ];

  if (note) {
    linkContent.push({
      type: "text",
      text: ` (${note})`,
    });
  }

  return {
    type: "paragraph",
    content: linkContent,
  };
}

/**
 * Parse existing TipTap JSON docs, or create a new document structure
 */
function parseExistingDocs(existingDocs: any): Record<string, unknown> {
  if (!existingDocs) {
    return {
      type: "doc",
      content: [],
    };
  }

  // If it's already an object (JsonValue), use it directly
  if (typeof existingDocs === "object" && existingDocs.type === "doc") {
    return existingDocs;
  }

  // If it's a string, try to parse it
  if (typeof existingDocs === "string") {
    try {
      const parsed = JSON.parse(existingDocs);
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
        return parsed;
      }
    } catch (e) {
      // If parsing fails, start fresh
    }
  }

  return {
    type: "doc",
    content: [],
  };
}

/**
 * Append links to existing TipTap document
 */
function appendLinksToDoc(
  doc: Record<string, any>,
  links: Record<string, unknown>[]
): Record<string, unknown> {
  if (!Array.isArray(doc.content)) {
    doc.content = [];
  }

  // Add each link as a new paragraph
  for (const link of links) {
    doc.content.push(link);
  }

  return doc;
}

const prepareDocsForUpdate = (
  existingDocs: unknown,
  updatedDocs: Record<string, unknown>
): string | Prisma.InputJsonValue => {
  if (typeof existingDocs === "string") {
    return JSON.stringify(updatedDocs);
  }
  return toInputJsonValue(updatedDocs);
};

/**
 * Import project_links as links in Projects.docs field
 * Converts links to TipTap JSON format and appends to existing docs
 */
export const importProjectLinks = async (
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  context: ImportContext
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "projectLinks",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const projectLinkRows = datasetRows.get("project_links") ?? [];
  summary.total = projectLinkRows.length;

  // Group links by project
  const linksByProjectId = new Map<number, Record<string, unknown>[]>();

  for (const row of projectLinkRows) {
    const testmoProjectId = toNumberValue(row.project_id);
    const name = toStringValue(row.name);
    const url = toStringValue(row.url);
    const note = toStringValue(row.note);

    if (!testmoProjectId || !name || !url) {
      continue;
    }

    const projectId = projectIdMap.get(testmoProjectId);
    if (!projectId) {
      continue;
    }

    const linkJson = createTipTapLink(name, url, note);

    if (!linksByProjectId.has(projectId)) {
      linksByProjectId.set(projectId, []);
    }
    linksByProjectId.get(projectId)!.push(linkJson);
  }

  // Update each project with appended links
  for (const [projectId, links] of linksByProjectId.entries()) {
    const project = await tx.projects.findUnique({
      where: { id: projectId },
      select: { docs: true },
    });

    if (!project) {
      continue;
    }

    const doc = parseExistingDocs(project.docs);
    const updatedDocs = appendLinksToDoc(doc, links);
    const docsValue = JSON.stringify(updatedDocs);

    await tx.projects.update({
      where: { id: projectId },
      data: { docs: docsValue },
    });

    summary.created += links.length;
  }

  return summary;
};

/**
 * Import milestone_links as links in Milestones.docs field
 * Converts links to TipTap JSON format and appends to existing docs
 */
export const importMilestoneLinks = async (
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  milestoneIdMap: Map<number, number>,
  context: ImportContext
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "milestoneLinks",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const milestoneLinkRows = datasetRows.get("milestone_links") ?? [];
  summary.total = milestoneLinkRows.length;

  // Group links by milestone
  const linksByMilestoneId = new Map<number, Record<string, unknown>[]>();

  for (const row of milestoneLinkRows) {
    const testmoMilestoneId = toNumberValue(row.milestone_id);
    const name = toStringValue(row.name);
    const url = toStringValue(row.url);
    const note = toStringValue(row.note);

    if (!testmoMilestoneId || !name || !url) {
      continue;
    }

    const milestoneId = milestoneIdMap.get(testmoMilestoneId);
    if (!milestoneId) {
      continue;
    }

    const linkJson = createTipTapLink(name, url, note);

    if (!linksByMilestoneId.has(milestoneId)) {
      linksByMilestoneId.set(milestoneId, []);
    }
    linksByMilestoneId.get(milestoneId)!.push(linkJson);
  }

  // Update each milestone with appended links
  for (const [milestoneId, links] of linksByMilestoneId.entries()) {
    const milestone = await tx.milestones.findUnique({
      where: { id: milestoneId },
      select: { docs: true },
    });

    if (!milestone) {
      continue;
    }

    const doc = parseExistingDocs(milestone.docs);
    const updatedDocs = appendLinksToDoc(doc, links);
    const docsValue = prepareDocsForUpdate(milestone.docs, updatedDocs);

    await tx.milestones.update({
      where: { id: milestoneId },
      data: { docs: docsValue },
    });

    summary.created += links.length;
  }

  return summary;
};

/**
 * Import run_links as links in TestRuns.docs field
 * Converts links to TipTap JSON format and appends to existing docs
 */
export const importRunLinks = async (
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  testRunIdMap: Map<number, number>,
  context: ImportContext
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "runLinks",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const runLinkRows = datasetRows.get("run_links") ?? [];
  summary.total = runLinkRows.length;

  // Group links by run
  const linksByRunId = new Map<number, Record<string, unknown>[]>();

  for (const row of runLinkRows) {
    const testmoRunId = toNumberValue(row.run_id);
    const name = toStringValue(row.name);
    const url = toStringValue(row.url);
    const note = toStringValue(row.note);

    if (!testmoRunId || !name || !url) {
      continue;
    }

    const runId = testRunIdMap.get(testmoRunId);
    if (!runId) {
      continue;
    }

    const linkJson = createTipTapLink(name, url, note);

    if (!linksByRunId.has(runId)) {
      linksByRunId.set(runId, []);
    }
    linksByRunId.get(runId)!.push(linkJson);
  }

  // Update each run with appended links
  for (const [runId, links] of linksByRunId.entries()) {
    const run = await tx.testRuns.findUnique({
      where: { id: runId },
      select: { docs: true },
    });

    if (!run) {
      continue;
    }

    const doc = parseExistingDocs(run.docs);
    const updatedDocs = appendLinksToDoc(doc, links);
    const docsValue = prepareDocsForUpdate(run.docs, updatedDocs);

    await tx.testRuns.update({
      where: { id: runId },
      data: { docs: docsValue },
    });

    summary.created += links.length;
  }

  return summary;
};
