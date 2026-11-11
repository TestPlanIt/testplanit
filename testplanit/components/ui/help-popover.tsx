import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface HelpPopoverProps {
  helpKey: string;
  side?: "left" | "right" | "top" | "bottom";
  tabIndex?: number;
}

export function HelpPopover({
  helpKey,
  side = "bottom",
  tabIndex,
}: HelpPopoverProps) {
  const tHelp = useTranslations("help");
  const tCommon = useTranslations("common");
  let contentToShow: string;

  // Handle empty or undefined helpKey
  if (!helpKey || helpKey.trim() === "") {
    return null;
  }

  if (helpKey.startsWith("## ")) {
    contentToShow = helpKey;
  } else {
    contentToShow = tHelp(helpKey as any);
  }

  const markdownComponents: Components = {
    h1: ({ node, ...props }) => (
      <h1 className="mt-2 mb-0 text-xl font-semibold text-primary" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="mt-2 mb-0 text-lg font-semibold text-primary" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3
        className="mt-1 mb-0 text-base font-semibold text-primary"
        {...props}
      />
    ),
    p: ({ node, ...props }) => (
      <p className="mb-3 text-sm text-foreground" {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul className="mb-3 list-disc ps-5" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="mb-3 list-decimal ps-5" {...props} />
    ),
    li: ({ node, ...props }) => <li className="mb-1 text-sm" {...props} />,
    a: ({ href, children }) => (
      <a href={href} className="text-primary underline hover:opacity-80">
        {children}
      </a>
    ),
    pre: ({ node, children, ...props }) => (
      <pre
        className="my-3 block overflow-x-auto rounded bg-muted p-4 font-mono text-sm"
        {...props}
      >
        {children}
      </pre>
    ),
    code: ({ node, className, children, ...props }: any) => (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-sm"
        {...props}
      >
        {children}
      </code>
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote
        className="my-3 border-s-4 border-border ps-4 italic"
        {...props}
      />
    ),
    hr: () => <hr className="my-4 border-t border-border" />,
    table: ({ node, ...props }) => (
      <table className="mb-4 w-full border-collapse" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th
        className="border border-border bg-muted p-2 text-start font-semibold"
        {...props}
      />
    ),
    td: ({ node, ...props }) => (
      <td className="border border-border p-2 text-start" {...props} />
    ),
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ms-2 inline-flex"
          tabIndex={tabIndex}
          aria-label={tCommon("aria.help")}
          // The icon often sits inside another trigger (a sortable table
          // header, a menu button); opening help must not also fire that.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        // Long entries scroll inside the space Radix leaves on the chosen
        // side instead of running off the viewport. The wheel event stops
        // here: the content is portaled outside a dialog's tree, where the
        // dialog's scroll lock would otherwise swallow it (same as CommandList).
        className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="p-4">
          <Markdown components={markdownComponents}>{contentToShow}</Markdown>
        </div>
      </PopoverContent>
    </Popover>
  );
}
