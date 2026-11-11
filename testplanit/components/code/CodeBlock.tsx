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
        "max-w-full overflow-auto rounded-md bg-stone-800 p-4 text-sm",
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
