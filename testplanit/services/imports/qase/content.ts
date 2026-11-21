import type { JSONContent } from "@tiptap/core";
import { emptyEditorContent } from "~/app/constants/backend";
import {
  convertPlainTextToTipTapJSON,
  ensureTipTapJSON,
} from "~/utils/tiptapConversion";
import type {
  QaseSourceField,
  QaseSourceOption,
  QaseTargetFieldType,
} from "./mapping";

type QaseRecord = Record<string, unknown>;

export interface QaseFile {
  url: string;
  filename: string;
  mime: string;
  size: number;
}

const IMAGE_TOKEN = (index: number) => `QASEIMAGE${index}TOKEN`;
const IMAGE_TOKEN_PATTERN = /QASEIMAGE(\d+)TOKEN/g;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

interface FoundImage {
  url: string;
  alt: string;
}

function extractImages(text: string): { text: string; images: FoundImage[] } {
  const images: FoundImage[] = [];
  const replace = (url: string, alt: string) => {
    images.push({ url, alt });
    return `\n\n${IMAGE_TOKEN(images.length - 1)}\n\n`;
  };
  const withoutMarkdown = text.replace(MARKDOWN_IMAGE, (_match, alt, url) =>
    replace(String(url), String(alt ?? ""))
  );
  const withoutHtml = withoutMarkdown.replace(HTML_IMAGE, (match, url) => {
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(match)?.[1] ?? "";
    return replace(String(url), alt);
  });
  return { text: withoutHtml, images };
}

/** The image addresses in a Qase text, in the order they appear. */
export function collectQaseImageUrls(text: unknown): string[] {
  return typeof text === "string" && text
    ? extractImages(text).images.map((image) => image.url)
    : [];
}

const imageNode = (src: string, alt: string): JSONContent => ({
  type: "image",
  attrs: { src, alt: alt || null, align: "center" },
});

function restoreImages(
  node: JSONContent,
  images: FoundImage[],
  resolve: (url: string) => string | null
): JSONContent[] {
  if (node.type === "paragraph" && node.content?.length === 1) {
    const only = node.content[0];
    const match =
      only.type === "text"
        ? /^QASEIMAGE(\d+)TOKEN$/.exec(only.text ?? "")
        : null;
    const image = match ? images[Number(match[1])] : undefined;
    if (image) {
      const src = resolve(image.url);
      return src
        ? [imageNode(src, image.alt)]
        : [
            {
              type: "paragraph",
              content: [{ type: "text", text: image.alt || image.url }],
            },
          ];
    }
  }
  if (node.type === "text" && node.text) {
    const text = node.text.replace(IMAGE_TOKEN_PATTERN, (_match, index) => {
      const image = images[Number(index)];
      return image ? image.alt || image.url : "";
    });
    return [{ ...node, text }];
  }
  if (!node.content) {
    return [node];
  }
  return [
    {
      ...node,
      content: node.content.flatMap((child) =>
        restoreImages(child, images, resolve)
      ),
    },
  ];
}

/**
 * A Qase text (Markdown, sometimes HTML) as an editor document. `resolveImage`
 * returns where a copied image now lives, or null when it could not be copied;
 * the image's alternative text is kept in that case.
 */
export function qaseTextToDoc(
  text: unknown,
  resolveImage: (url: string) => string | null = () => null
): JSONContent {
  if (typeof text !== "string" || !text.trim()) {
    return emptyEditorContent as JSONContent;
  }
  const extracted = extractImages(text);
  const doc = ensureTipTapJSON(extracted.text);
  if (extracted.images.length === 0) {
    return doc;
  }
  return restoreImages(doc, extracted.images, resolveImage)[0] ?? doc;
}

export const isEmptyDoc = (doc: JSONContent): boolean =>
  !doc.content ||
  doc.content.every(
    (node) => node.type === "paragraph" && (node.content?.length ?? 0) === 0
  );

/** Appends blocks to a document, dropping the placeholder of an empty one. */
export function appendToDoc(
  doc: JSONContent,
  nodes: JSONContent[]
): JSONContent {
  if (nodes.length === 0) {
    return doc;
  }
  return {
    type: "doc",
    content: [...(isEmptyDoc(doc) ? [] : (doc.content ?? [])), ...nodes],
  };
}

export type QaseFlatStep =
  | { kind: "shared"; hash: string }
  | {
      kind: "step";
      action: string;
      expected: string;
      plain: boolean;
      attachments: QaseFile[];
    };

const asText = (value: unknown) => (typeof value === "string" ? value : "");

export function toQaseFiles(value: unknown): QaseFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: QaseFile[] = [];
  for (const entry of value as QaseRecord[]) {
    const url = asText(entry?.url);
    if (!url) {
      continue;
    }
    files.push({
      url,
      filename: asText(entry.filename) || url.split("/").pop() || "attachment",
      mime: asText(entry.mime) || "application/octet-stream",
      size: typeof entry.size === "number" ? entry.size : 0,
    });
  }
  return files;
}

function stepAction(step: QaseRecord): string {
  const action = asText(step.action);
  const data = asText(step.data).trim();
  return data ? `${action}\n\n**Input data:** ${data}` : action;
}

function flattenClassic(steps: unknown, into: QaseFlatStep[]): void {
  if (!Array.isArray(steps)) {
    return;
  }
  const ordered = [...(steps as QaseRecord[])].sort(
    (a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)
  );
  let lastSharedHash: string | null = null;
  for (const step of ordered) {
    const shared = asText(step.shared_step_hash);
    if (shared) {
      // A shared step arrives expanded: one entry per step it contains.
      if (shared !== lastSharedHash) {
        into.push({ kind: "shared", hash: shared });
        lastSharedHash = shared;
      }
      continue;
    }
    lastSharedHash = null;
    into.push({
      kind: "step",
      action: stepAction(step),
      expected: asText(step.expected_result),
      plain: false,
      attachments: toQaseFiles(step.attachments),
    });
    flattenClassic(step.steps, into);
  }
}

/**
 * A case's or shared step's steps in execution order. Nested steps follow
 * their parent; a Gherkin scenario becomes one step holding its text.
 */
export function flattenQaseSteps(
  steps: unknown,
  stepsType: unknown = "classic"
): QaseFlatStep[] {
  const flat: QaseFlatStep[] = [];
  if (stepsType === "gherkin") {
    for (const step of Array.isArray(steps) ? (steps as QaseRecord[]) : []) {
      const text = asText(step.action) || asText(step.value);
      if (text.trim()) {
        flat.push({
          kind: "step",
          action: text,
          expected: "",
          plain: true,
          attachments: [],
        });
      }
    }
    return flat;
  }
  flattenClassic(steps, flat);
  return flat;
}

export const stepTextToDoc = (
  text: string,
  plain: boolean,
  resolveImage?: (url: string) => string | null
): JSONContent =>
  plain
    ? convertPlainTextToTipTapJSON(text)
    : qaseTextToDoc(text, resolveImage);

/** Qase system fields that become case fields, with the type they map to. */
const SYSTEM_FIELDS: Record<string, QaseTargetFieldType> = {
  description: "Text Long",
  preconditions: "Text Long",
  postconditions: "Text Long",
  priority: "Dropdown",
  severity: "Dropdown",
  type: "Dropdown",
  behavior: "Dropdown",
  layer: "Dropdown",
  is_flaky: "Checkbox",
};

const SYSTEM_FIELD_ORDER = Object.keys(SYSTEM_FIELDS);

/** "Not set" choices are an empty field in TestPlanIt, not an option. */
const UNSET_OPTION_SLUGS = new Set(["undefined", "unknown"]);

const CUSTOM_FIELD_TYPES: Record<string, QaseTargetFieldType> = {
  number: "Number",
  string: "Text String",
  text: "Text Long",
  selectbox: "Dropdown",
  radio: "Dropdown",
  multiselect: "Multi-Select",
  checkbox: "Checkbox",
  url: "Link",
  datetime: "Date",
};

function toOptions(value: unknown, dropUnset: boolean): QaseSourceOption[] {
  let list: unknown = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const options: QaseSourceOption[] = [];
  for (const entry of list as QaseRecord[]) {
    const title = asText(entry?.title).trim();
    if (!title || entry.id === undefined || entry.id === null) {
      continue;
    }
    if (dropUnset && UNSET_OPTION_SLUGS.has(asText(entry.slug))) {
      continue;
    }
    options.push({ id: String(entry.id), title });
  }
  return options;
}

/** The case statuses Qase defines, from its `status` system field. */
export function qaseCaseStatuses(
  systemFields: QaseRecord[]
): QaseSourceOption[] {
  const status = systemFields.find((field) => field.slug === "status");
  return toOptions(status?.options, false);
}

/**
 * The Qase fields offered for mapping: the system fields that hold case
 * content, then the custom case fields enabled for a selected project.
 */
export function qaseSourceFields(
  systemFields: QaseRecord[],
  customFields: QaseRecord[],
  projectCodes: string[]
): QaseSourceField[] {
  const fields: QaseSourceField[] = [];
  for (const slug of SYSTEM_FIELD_ORDER) {
    const field = systemFields.find((candidate) => candidate.slug === slug);
    if (!field) {
      continue;
    }
    const targetType = SYSTEM_FIELDS[slug];
    fields.push({
      key: `system:${slug}`,
      title: asText(field.title) || slug,
      targetType,
      options: targetType === "Dropdown" ? toOptions(field.options, true) : [],
    });
  }
  for (const field of customFields) {
    if (asText(field.entity).toLowerCase() !== "case") {
      continue;
    }
    const targetType = CUSTOM_FIELD_TYPES[asText(field.type).toLowerCase()];
    if (!targetType) {
      continue;
    }
    const codes = Array.isArray(field.projects_codes)
      ? (field.projects_codes as unknown[]).map(String)
      : [];
    if (
      field.is_enabled_for_all_projects !== true &&
      !codes.some((code) => projectCodes.includes(code))
    ) {
      continue;
    }
    fields.push({
      key: `custom:${String(field.id)}`,
      title: asText(field.title) || `Field ${String(field.id)}`,
      targetType,
      options:
        targetType === "Dropdown" || targetType === "Multi-Select"
          ? toOptions(field.value, false)
          : [],
    });
  }
  return fields;
}

/** A field's raw value(s) on a case: one entry, or several for a multiselect. */
export function qaseCaseFieldRawValues(
  caseRecord: QaseRecord,
  fieldKey: string
): unknown[] {
  if (fieldKey.startsWith("system:")) {
    const value = caseRecord[fieldKey.slice("system:".length)];
    return value === undefined || value === null ? [] : [value];
  }
  const id = fieldKey.slice("custom:".length);
  const entries = Array.isArray(caseRecord.custom_fields)
    ? (caseRecord.custom_fields as QaseRecord[])
    : [];
  return entries
    .filter((entry) => String(entry?.id) === id)
    .map((entry) => entry.value)
    .filter((value) => value !== undefined && value !== null && value !== "");
}

export interface QaseFieldTarget {
  type: QaseTargetFieldType;
  /** Target option id by lower-cased option name. */
  optionIds: Map<string, number>;
}

export type QaseConvertedValue =
  | { kind: "value"; value: string | number | boolean | number[] }
  | { kind: "empty" }
  | { kind: "unmatched"; option: string };

/**
 * A Qase field value in the shape TestPlanIt stores for the target type.
 * Text Long values are converted by the caller, which owns the images.
 */
export function convertQaseFieldValue(
  field: QaseSourceField,
  rawValues: unknown[],
  target: QaseFieldTarget
): QaseConvertedValue {
  if (rawValues.length === 0) {
    return { kind: "empty" };
  }
  const first = rawValues[0];
  const optionId = (raw: unknown): number | string | null => {
    const option = field.options.find((entry) => entry.id === String(raw));
    if (!option) {
      return null;
    }
    return target.optionIds.get(option.title.toLowerCase()) ?? option.title;
  };

  switch (target.type) {
    case "Dropdown": {
      const id = optionId(first);
      if (id === null) {
        return { kind: "empty" };
      }
      return typeof id === "number"
        ? { kind: "value", value: id }
        : { kind: "unmatched", option: id };
    }
    case "Multi-Select": {
      const ids: number[] = [];
      let unmatched: string | null = null;
      for (const raw of rawValues.flatMap((value) =>
        String(value).split(",")
      )) {
        const id = optionId(raw.trim());
        if (typeof id === "number") {
          ids.push(id);
        } else if (typeof id === "string") {
          unmatched = id;
        }
      }
      if (ids.length > 0) {
        return { kind: "value", value: ids };
      }
      return unmatched
        ? { kind: "unmatched", option: unmatched }
        : { kind: "empty" };
    }
    case "Checkbox": {
      const checked =
        first === true || first === 1 || first === "1" || first === "true";
      return { kind: "value", value: checked };
    }
    case "Number": {
      const parsed = Number(first);
      return Number.isFinite(parsed) && String(first).trim() !== ""
        ? { kind: "value", value: parsed }
        : { kind: "empty" };
    }
    case "Link": {
      const text = String(first).trim();
      return /^https?:\/\//i.test(text)
        ? { kind: "value", value: text }
        : { kind: "empty" };
    }
    case "Date": {
      const date = new Date(String(first));
      return Number.isNaN(date.getTime())
        ? { kind: "empty" }
        : { kind: "value", value: date.toISOString() };
    }
    default: {
      const text = String(first);
      return text.trim() ? { kind: "value", value: text } : { kind: "empty" };
    }
  }
}

export interface QaseParameterSet {
  names: string[];
  rows: Record<string, string>[];
  /** True when the combinations exceeded the cap and no rows were built. */
  truncated: boolean;
}

export const QASE_MAX_PARAMETER_ROWS = 500;

interface ParameterBlock {
  names: string[];
  rows: Record<string, string>[];
}

function toParameterBlock(entry: QaseRecord): ParameterBlock | null {
  const items = Array.isArray(entry.items)
    ? (entry.items as QaseRecord[])
    : isSingle(entry.item)
      ? [entry.item]
      : [];
  const columns = items
    .map((item) => ({
      name: asText(item.title).trim(),
      values: Array.isArray(item.values) ? item.values.map(String) : [],
    }))
    .filter((column) => column.name);
  if (columns.length === 0) {
    return null;
  }
  const length = Math.max(...columns.map((column) => column.values.length));
  const rows: Record<string, string>[] = [];
  for (let index = 0; index < length; index++) {
    const row: Record<string, string> = {};
    for (const column of columns) {
      row[column.name] = column.values[index] ?? "";
    }
    rows.push(row);
  }
  return { names: columns.map((column) => column.name), rows };
}

function isSingle(value: unknown): value is QaseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A case's parameters as names plus the rows Qase would run: every
 * combination of the separate parameters, with a group's values kept together.
 */
export function buildQaseParameterSet(parameters: unknown): QaseParameterSet {
  const blocks: ParameterBlock[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(parameters)
    ? (parameters as QaseRecord[])
    : []) {
    const block = toParameterBlock(entry);
    if (!block || block.names.some((name) => seen.has(name))) {
      continue;
    }
    block.names.forEach((name) => seen.add(name));
    blocks.push(block);
  }
  const names = blocks.flatMap((block) => block.names);
  const total = blocks.reduce(
    (product, block) => product * Math.max(block.rows.length, 1),
    1
  );
  if (names.length === 0) {
    return { names: [], rows: [], truncated: false };
  }
  if (total > QASE_MAX_PARAMETER_ROWS) {
    return { names, rows: [], truncated: true };
  }
  let rows: Record<string, string>[] = [{}];
  for (const block of blocks) {
    if (block.rows.length === 0) {
      continue;
    }
    rows = rows.flatMap((row) =>
      block.rows.map((blockRow) => ({ ...row, ...blockRow }))
    );
  }
  const hasValues = blocks.some((block) => block.rows.length > 0);
  return { names, rows: hasValues ? rows : [], truncated: false };
}

/** Result statuses nothing is recorded for: no result yet, or a removed one. */
const UNRECORDED_RESULT_STATUSES = new Set(["untested", "deleted"]);

/** The result statuses to map, identified by their Qase slug. */
export function qaseResultStatuses(
  systemFields: QaseRecord[]
): QaseSourceOption[] {
  const field = systemFields.find(
    (candidate) => candidate.slug === "result_status"
  );
  const options = Array.isArray(field?.options)
    ? (field.options as QaseRecord[])
    : [];
  return options
    .map((option) => ({
      id: asText(option.slug),
      title: asText(option.title) || asText(option.slug),
    }))
    .filter(
      (option) => option.id && !UNRECORDED_RESULT_STATUSES.has(option.id)
    );
}

/** Result status slug by the number step results use for it. */
export function qaseResultStatusSlugs(
  systemFields: QaseRecord[]
): Map<number, string> {
  const field = systemFields.find(
    (candidate) => candidate.slug === "result_status"
  );
  const slugs = new Map<number, string>();
  for (const option of Array.isArray(field?.options)
    ? (field.options as QaseRecord[])
    : []) {
    if (typeof option.id === "number" && asText(option.slug)) {
      slugs.set(option.id, asText(option.slug));
    }
  }
  return slugs;
}

/**
 * Where a Qase step ended up in the imported case: the position of its row
 * among the case's steps and, for a step that came from a shared step, its
 * position inside that shared step.
 */
export interface QaseStepSlot {
  index: number;
  sharedItem: number | null;
}

const positionOf = (step: QaseRecord, fallback: number) => {
  const position = Number(step.position);
  return Number.isFinite(position) && position > 0 ? position : fallback;
};

const orderedSteps = (steps: unknown): { step: QaseRecord; at: number }[] =>
  (Array.isArray(steps) ? (steps as QaseRecord[]) : [])
    .map((step, index) => ({ step, at: positionOf(step, index + 1) }))
    .sort((a, b) => a.at - b.at);

/**
 * Each Qase step's slot, keyed by its path of positions ("2.1" is the first
 * step nested under the second). Follows the same order as flattenQaseSteps,
 * so `index` is the order of the step's row in TestPlanIt.
 */
export function qaseStepSlots(
  steps: unknown,
  stepsType: unknown = "classic"
): Map<string, QaseStepSlot> {
  const slots = new Map<string, QaseStepSlot>();
  if (stepsType === "gherkin") {
    let index = 0;
    for (const { step, at } of orderedSteps(steps)) {
      if ((asText(step.action) || asText(step.value)).trim()) {
        slots.set(String(at), { index, sharedItem: null });
        index += 1;
      }
    }
    return slots;
  }
  let next = 0;
  const walk = (level: unknown, prefix: string) => {
    let lastSharedHash: string | null = null;
    let sharedIndex = -1;
    let sharedItem = 0;
    for (const { step, at } of orderedSteps(level)) {
      const path = `${prefix}${at}`;
      const shared = asText(step.shared_step_hash);
      if (shared) {
        if (shared !== lastSharedHash) {
          lastSharedHash = shared;
          sharedIndex = next;
          sharedItem = 0;
          next += 1;
        }
        slots.set(path, { index: sharedIndex, sharedItem });
        sharedItem += 1;
        continue;
      }
      lastSharedHash = null;
      slots.set(path, { index: next, sharedItem: null });
      next += 1;
      walk(step.steps, `${path}.`);
    }
  };
  walk(steps, "");
  return slots;
}

export interface QaseStepResult {
  /** Path of positions, as in qaseStepSlots. */
  path: string;
  /** Qase's number for the status. */
  status: number | null;
  comment: string;
  attachments: QaseFile[];
}

/** A result's step results, nested ones included, in execution order. */
export function flattenQaseStepResults(steps: unknown): QaseStepResult[] {
  const flat: QaseStepResult[] = [];
  const walk = (level: unknown, prefix: string) => {
    for (const { step, at } of orderedSteps(level)) {
      const path = `${prefix}${at}`;
      flat.push({
        path,
        status: typeof step.status === "number" ? step.status : null,
        comment: asText(step.comment),
        attachments: toQaseFiles(step.attachments),
      });
      walk(step.steps, `${path}.`);
    }
  };
  walk(steps, "");
  return flat;
}

/** The cases of a run, once each: Qase lists one per parameter combination. */
export function qaseRunCaseIds(run: QaseRecord): string[] {
  const ids = new Set<string>();
  for (const id of Array.isArray(run.cases) ? run.cases : []) {
    if (typeof id === "number" || typeof id === "string") {
      ids.add(String(id));
    }
  }
  return [...ids];
}

/** A run counts as finished once Qase gave it an end or a final status. */
export const isQaseRunCompleted = (run: QaseRecord): boolean =>
  !!asText(run.end_time) ||
  (asText(run.status_text) !== "" &&
    !["active", "in_progress"].includes(asText(run.status_text)));

/** A result's comment with its stack trace, as Qase Markdown. */
export function qaseResultNotes(result: QaseRecord): string {
  const comment = asText(result.comment).trim();
  const stacktrace = asText(result.stacktrace).trim();
  return [comment, stacktrace ? `\`\`\`\n${stacktrace}\n\`\`\`` : ""]
    .filter(Boolean)
    .join("\n\n");
}

/** Milliseconds as whole seconds, kept within a 32-bit column. */
export function qaseSeconds(milliseconds: unknown): number | null {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(Math.round(value / 1000), 2_147_483_647);
}

/**
 * A run's description followed by its custom field values, one per line.
 * TestPlanIt runs have no custom fields, so the values are kept in the text.
 */
export function qaseRunDescription(
  run: QaseRecord,
  customFields: QaseRecord[]
): string {
  const lines: string[] = [];
  for (const entry of Array.isArray(run.custom_fields)
    ? (run.custom_fields as QaseRecord[])
    : []) {
    const field = customFields.find(
      (candidate) => candidate.id === entry.id && candidate.entity === "run"
    );
    const raw = asText(entry.value).trim();
    if (!field || !raw) {
      continue;
    }
    let shown = raw;
    try {
      const choices = JSON.parse(asText(field.value)) as QaseRecord[];
      const choice = Array.isArray(choices)
        ? choices.find((candidate) => String(candidate.id) === raw)
        : undefined;
      shown = asText(choice?.title) || raw;
    } catch {
      // Not a choice field: the value is shown as it is.
    }
    const existing = lines.findIndex((line) =>
      line.startsWith(`**${asText(field.title)}:** `)
    );
    if (existing >= 0) {
      lines[existing] += `, ${shown}`;
    } else {
      lines.push(`**${asText(field.title)}:** ${shown}`);
    }
  }
  return [asText(run.description).trim(), lines.join("\n\n")]
    .filter(Boolean)
    .join("\n\n");
}
