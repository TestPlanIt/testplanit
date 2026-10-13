"use client";

import "prismjs/themes/prism-tomorrow.css";
import { useMemo } from "react";
import { highlightCode } from "~/lib/utils/codeHighlight";
import { cn } from "~/utils";

export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language: string;
  className?: string;
}) {
  const html = useMemo(() => highlightCode(code, language), [code, language]);

  return (
    <pre
      className={cn(
        "bg-stone-800 rounded-md overflow-auto p-4 text-sm max-w-full",
        className
      )}
    >
      <code
        className={`language-${language}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}
