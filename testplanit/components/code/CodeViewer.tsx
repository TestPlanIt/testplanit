"use client";

import "prismjs/themes/prism-tomorrow.css";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { highlightCode } from "~/lib/utils/codeHighlight";
import { cn } from "~/utils";

export type LineRange = [number, number];

export interface CodeViewerProps {
  code: string;
  language?: string;
  selection: LineRange | null;
  onSelectionChange: (range: LineRange | null) => void;
  maxLines?: number;
  className?: string;
}

const DEFAULT_MAX_LINES = 5000;

function splitLines(code: string): string[] {
  if (!code) return [];
  const lines = code.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function nextSelection(
  current: LineRange | null,
  line: number,
  extend: boolean
): LineRange | null {
  if (extend && current) {
    return [Math.min(current[0], line), Math.max(current[1], line)];
  }
  if (current && line >= current[0] && line <= current[1]) return null;
  return [line, line];
}

export function CodeViewer({
  code,
  language = "markup",
  selection,
  onSelectionChange,
  maxLines = DEFAULT_MAX_LINES,
  className,
}: CodeViewerProps) {
  const t = useTranslations("repository.codePins");
  const lines = useMemo(() => splitLines(code), [code]);
  const tooLarge = lines.length > maxLines;
  const html = useMemo(
    () => (tooLarge ? [] : lines.map((line) => highlightCode(line, language))),
    [lines, language, tooLarge]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (scrolledRef.current || tooLarge || !selection || lines.length === 0) {
      return;
    }
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-line="${selection[0]}"]`
    );
    if (!row) return;
    scrolledRef.current = true;
    if (typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "center" });
    }
  }, [selection, lines, tooLarge]);

  if (tooLarge) {
    return (
      <div
        data-testid="code-viewer"
        className={cn(
          "rounded-md border p-4 text-sm text-muted-foreground",
          className
        )}
      >
        {t("viewerTooLarge")}
      </div>
    );
  }

  const activate = (line: number, extend: boolean) =>
    onSelectionChange(nextSelection(selection, line, extend));

  const handleClick =
    (line: number) => (event: MouseEvent<HTMLTableCellElement>) =>
      activate(line, event.shiftKey);

  const handleKeyDown =
    (line: number) => (event: KeyboardEvent<HTMLTableCellElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate(line, event.shiftKey);
    };

  return (
    <div
      ref={containerRef}
      data-testid="code-viewer"
      className={cn(
        "max-h-[60vh] overflow-auto rounded-md bg-stone-800 text-sm max-w-full",
        className
      )}
    >
      <table className="w-full border-collapse font-mono">
        <tbody>
          {lines.map((_, index) => {
            const lineNumber = index + 1;
            const selected =
              selection !== null &&
              lineNumber >= selection[0] &&
              lineNumber <= selection[1];
            return (
              <tr
                key={lineNumber}
                data-line={lineNumber}
                aria-selected={selected}
                className={cn(selected && "bg-primary/10")}
              >
                <td
                  role="button"
                  tabIndex={0}
                  data-testid={`code-viewer-line-${lineNumber}`}
                  onClick={handleClick(lineNumber)}
                  onKeyDown={handleKeyDown(lineNumber)}
                  className={cn(
                    "select-none w-[1%] cursor-pointer whitespace-nowrap pl-3 pr-3 text-right align-top text-stone-500 hover:text-stone-200 focus-visible:text-stone-200 focus-visible:outline-none",
                    selected && "text-stone-100"
                  )}
                >
                  {lineNumber}
                </td>
                <td className="pr-4 align-top">
                  <pre className="m-0 bg-transparent p-0">
                    <code
                      className={`language-${language}`}
                      dangerouslySetInnerHTML={{ __html: html[index] }}
                    />
                  </pre>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
