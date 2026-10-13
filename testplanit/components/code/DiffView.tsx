"use client";

import "prismjs/themes/prism-tomorrow.css";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { highlightCode } from "~/lib/utils/codeHighlight";
import { cn } from "~/utils";

import { Button } from "@/components/ui/button";

export type DiffLineType = "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffViewProps {
  patch: string;
  language?: string;
  maxLines?: number;
  className?: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DEFAULT_MAX_LINES = 2000;

const ROW_CLASSES: Record<DiffLineType, string> = {
  add: "bg-success/10",
  del: "bg-destructive/10",
  ctx: "",
  meta: "bg-stone-700/40 text-stone-400",
};

const MARKERS: Record<DiffLineType, string> = {
  add: "+",
  del: "-",
  ctx: " ",
  meta: "",
};

export function parseDiffLines(patch: string): DiffLine[] {
  if (!patch) return [];
  const lines = patch.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();

  const out: DiffLine[] = [];
  let inHunk = false;
  let oldNumber = 0;
  let newNumber = 0;

  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      inHunk = true;
      oldNumber = parseInt(header[1], 10);
      newNumber = parseInt(header[3], 10);
      out.push({ type: "meta", text: line, oldNumber: null, newNumber: null });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) {
      out.push({ type: "meta", text: line, oldNumber: null, newNumber: null });
      continue;
    }
    const marker = line[0];
    if (marker === "+") {
      out.push({
        type: "add",
        text: line.slice(1),
        oldNumber: null,
        newNumber: newNumber++,
      });
    } else if (marker === "-") {
      out.push({
        type: "del",
        text: line.slice(1),
        oldNumber: oldNumber++,
        newNumber: null,
      });
    } else if (marker === " " || line === "") {
      out.push({
        type: "ctx",
        text: line.slice(1),
        oldNumber: oldNumber++,
        newNumber: newNumber++,
      });
    } else {
      inHunk = false;
    }
  }
  return out;
}

export function DiffView({
  patch,
  language = "markup",
  maxLines = DEFAULT_MAX_LINES,
  className,
}: DiffViewProps) {
  const t = useTranslations("repository.diffView");
  const tDiff = useTranslations("runs.impact.diff");
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => parseDiffLines(patch), [patch]);
  const truncated = !expanded && lines.length > maxLines;
  const visible = useMemo(
    () => (truncated ? lines.slice(0, maxLines) : lines),
    [lines, truncated, maxLines]
  );
  const html = useMemo(
    () =>
      visible.map((line) =>
        line.type === "meta" ? "" : highlightCode(line.text, language)
      ),
    [visible, language]
  );

  return (
    <div
      data-testid="diff-view"
      className={cn(
        "bg-stone-800 rounded-md overflow-x-auto text-sm max-w-full",
        className
      )}
    >
      <table className="w-full border-collapse font-mono">
        <tbody>
          {visible.map((line, index) => (
            <tr
              key={index}
              data-line-type={line.type}
              className={ROW_CLASSES[line.type]}
            >
              <td
                aria-label={t("oldLine")}
                className="select-none w-[1%] whitespace-nowrap pl-3 pr-2 text-right align-top text-stone-500"
              >
                {line.oldNumber ?? ""}
              </td>
              <td
                aria-label={t("newLine")}
                className="select-none w-[1%] whitespace-nowrap pr-2 text-right align-top text-stone-500"
              >
                {line.newNumber ?? ""}
              </td>
              <td className="pr-4 align-top">
                {line.type === "meta" ? (
                  <span className="whitespace-pre">{line.text}</span>
                ) : (
                  <div className="flex">
                    {line.type === "add" && (
                      <span className="sr-only">{t("added")}</span>
                    )}
                    {line.type === "del" && (
                      <span className="sr-only">{t("removed")}</span>
                    )}
                    <span
                      aria-hidden="true"
                      className="select-none w-4 shrink-0 whitespace-pre text-stone-500"
                    >
                      {MARKERS[line.type]}
                    </span>
                    <pre className="m-0 bg-transparent p-0">
                      <code
                        className={`language-${language}`}
                        dangerouslySetInnerHTML={{ __html: html[index] }}
                      />
                    </pre>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        {truncated && (
          <tfoot>
            <tr>
              <td colSpan={3} className="p-2 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="diff-view-expand"
                  className="text-stone-200 hover:bg-stone-700 hover:text-white"
                  onClick={() => setExpanded(true)}
                >
                  {tDiff("showFullPatch")}
                </Button>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
