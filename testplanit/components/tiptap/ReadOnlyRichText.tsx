"use client";

import { useTranslations } from "next-intl";
import React, { useMemo, useSyncExternalStore } from "react";

import type {
  ParameterChipMeta,
  ParameterMentionMessages,
} from "~/lib/tiptap/parameterMentionExtension";
import {
  readOnlyRichTextHtml,
  toReadOnlyDocument,
} from "~/lib/tiptap/readOnlyRichTextHtml";
import styles from "~/styles/TipTapEditor.module.css";
import { cn } from "~/utils";
import { UndeclaredParameterWarning } from "./UndeclaredParameterWarning";

const subscribeToNothing = () => () => {};

export interface ReadOnlyRichTextProps {
  /** The stored TipTap document, as JSON or its string form. */
  content: unknown;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Parameter chip metadata for the surface, with the values to substitute.
   * Undefined on surfaces that are not parameter-aware; an empty list on one
   * that is but has no active iteration.
   */
  parameters?: ParameterChipMeta[];
  "data-testid"?: string;
}

/**
 * Displays a stored rich-text document without mounting an editor.
 *
 * Drop-in for `<TipTapEditor readOnly />` on surfaces that only show content:
 * the markup carries the editor's classes (so the ProseMirror stylesheet and
 * the prose plugin paint it the same way) and parameter chips keep their
 * copy and reveal behaviour, which the chip extension wires through a
 * document-level handler rather than the editor. See
 * lib/tiptap/readOnlyRichTextHtml.ts for what is rendered and how.
 */
const ReadOnlyRichText: React.FC<ReadOnlyRichTextProps> = ({
  content,
  className,
  style,
  parameters,
  "data-testid": testId,
}) => {
  const tParams = useTranslations("parameters");

  const messages = useMemo<ParameterMentionMessages>(
    () => ({
      clickToReveal: tParams("chipClickToReveal"),
      copyValue: tParams("chipCopyValue"),
      copyAriaLabel: (label: string) => tParams("chipCopyAriaLabel", { label }),
      copiedToast: (label: string) => tParams("chipCopiedToast", { label }),
      copyFailedToast: (label: string) =>
        tParams("chipCopyFailedToast", { label }),
    }),
    [tParams]
  );

  // Client-only, as the editor is (it renders nothing until it mounts): the
  // serialiser needs a document and the sanitiser a window, and the hydration
  // pass has to match the empty server markup.
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
  const doc = useMemo(() => toReadOnlyDocument(content), [content]);
  const html = useMemo(
    () => (isClient ? readOnlyRichTextHtml(doc, { parameters, messages }) : ""),
    [isClient, doc, parameters, messages]
  );
  const declaredNames = useMemo(
    () => parameters?.map((p) => p.name) ?? [],
    [parameters]
  );

  return (
    <div
      className={cn("flex w-full flex-col overflow-auto", className)}
      style={style}
      data-testid={testId}
    >
      <div className="relative w-full flex-1 overflow-y-auto">
        <div
          className={cn(
            "prose-xs prose mt-0.5 w-full max-w-none rounded-lg border border-accent-foreground/10 sm:prose-sm lg:prose xl:prose-lg",
            styles.editorContent
          )}
        >
          <div
            className="tiptap ProseMirror prose-xs prose w-full max-w-none p-1 sm:prose-sm lg:prose dark:prose-invert"
            style={{ width: "100%", maxWidth: "none" }}
            data-read-only-rich-text=""
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
      {parameters && parameters.length > 0 && (
        <UndeclaredParameterWarning
          editorJson={doc}
          declaredNames={declaredNames}
        />
      )}
    </div>
  );
};

export default React.memo(ReadOnlyRichText);
