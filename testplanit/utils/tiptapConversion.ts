import { JSONContent } from "@tiptap/core";
import { generateJSON } from "@tiptap/html";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { emptyEditorContent } from "~/app/constants/backend";

const tiptapConversionExtensions = [
  StarterKit.configure({
    link: false,
    underline: false,
  }),
  Underline,
  Link,
  TextStyle,
  Color,
];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const applyInlineFormatting = (text: string): string => {
  const matches: Array<{
    start: number;
    end: number;
    type: "bold" | "italic";
    content: string;
  }> = [];

  const boldPattern = /\*\*(.*?)\*\*/g;
  const italicPattern = /\*(.*?)\*/g;

  let boldMatch: RegExpExecArray | null;
  while ((boldMatch = boldPattern.exec(text)) !== null) {
    matches.push({
      start: boldMatch.index,
      end: boldMatch.index + boldMatch[0].length,
      type: "bold",
      content: boldMatch[1],
    });
  }

  italicPattern.lastIndex = 0;
  let italicMatch: RegExpExecArray | null;
  while ((italicMatch = italicPattern.exec(text)) !== null) {
    const insideBold = matches.some(
      (bold) => italicMatch!.index > bold.start && italicMatch!.index < bold.end
    );
    if (!insideBold) {
      matches.push({
        start: italicMatch.index,
        end: italicMatch.index + italicMatch[0].length,
        type: "italic",
        content: italicMatch[1],
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  let output = "";
  let currentIndex = 0;

  matches.forEach((match) => {
    if (currentIndex < match.start) {
      output += escapeHtml(text.substring(currentIndex, match.start));
    }

    const escapedContent = escapeHtml(match.content);
    output +=
      match.type === "bold"
        ? `<strong>${escapedContent}</strong>`
        : `<em>${escapedContent}</em>`;

    currentIndex = match.end;
  });

  if (currentIndex < text.length) {
    output += escapeHtml(text.substring(currentIndex));
  }

  return output || escapeHtml(text);
};

export const convertHtmlToTipTapJSON = (html: string): JSONContent => {
  const sanitized = html ? html.trim() : "";
  if (!sanitized) {
    return emptyEditorContent as JSONContent;
  }

  try {
    return generateJSON(sanitized, tiptapConversionExtensions) as JSONContent;
  } catch (error) {
    console.error("Failed to convert HTML to TipTap JSON:", error);
    return emptyEditorContent as JSONContent;
  }
};

export const convertTextToTipTapJSON = (text: string): JSONContent => {
  const trimmed = text ? text.trim() : "";
  if (!trimmed) {
    return emptyEditorContent as JSONContent;
  }

  const blocks = trimmed
    .split(new RegExp("\n{2,}"))
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const htmlParts = blocks.map((block) => {
    const rawLines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const isBulletList =
      rawLines.length > 0 && rawLines.every((line) => /^[-\*•]\s+/.test(line));

    const isNumberedList =
      rawLines.length > 0 &&
      rawLines.every((line) => /^\d+[\.\)]\s+/.test(line));

    if (isBulletList) {
      const items = rawLines
        .map((line) => line.replace(/^[-\*•]\s+/, ""))
        .map((line) => `<li>${applyInlineFormatting(line)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }

    if (isNumberedList) {
      const items = rawLines
        .map((line) => line.replace(/^\d+[\.\)]\s+/, ""))
        .map((line) => `<li>${applyInlineFormatting(line)}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }

    const paragraphLines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const paragraphHtml = paragraphLines
      .map((line) => applyInlineFormatting(line))
      .join("<br />");

    return `<p>${paragraphHtml}</p>`;
  });

  const html = htmlParts.join("") || `<p>${escapeHtml(trimmed)}</p>`;
  return convertHtmlToTipTapJSON(html);
};

export const ensureTipTapJSON = (value: any): JSONContent => {
  if (value === null || value === undefined) {
    return emptyEditorContent as JSONContent;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return emptyEditorContent as JSONContent;
    }

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && parsed.type === "doc") {
          return parsed as JSONContent;
        }
      } catch {
        // fall through to plain-text handling
      }
    }

    if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) {
      return convertHtmlToTipTapJSON(trimmed);
    }

    return convertTextToTipTapJSON(trimmed);
  }

  if (typeof value === "object") {
    if ((value as JSONContent).type === "doc") {
      return value as JSONContent;
    }

    try {
      return ensureTipTapJSON(JSON.stringify(value));
    } catch {
      return convertTextToTipTapJSON(String(value));
    }
  }

  return convertTextToTipTapJSON(String(value));
};

export const serializeTipTapJSON = (value: any): string => {
  try {
    return JSON.stringify(ensureTipTapJSON(value));
  } catch (
    error
  ) {
    console.error("Failed to serialize TipTap JSON:", error);
    return JSON.stringify(emptyEditorContent);
  }
};
