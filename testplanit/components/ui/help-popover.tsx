import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { useTranslations } from "next-intl";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";

interface HelpPopoverProps {
  helpKey: string;
  side?: "left" | "right" | "top" | "bottom";
  tabIndex?: number;
}

export function HelpPopover({ helpKey, side = "bottom", tabIndex }: HelpPopoverProps) {
  const tHelp = useTranslations("help");
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
      <h1 className="text-xl font-semibold mt-2 mb-0 text-primary" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-lg font-semibold mt-2 mb-0 text-primary" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3
        className="text-base font-semibold mt-1 mb-0 text-primary"
        {...props}
      />
    ),
    p: ({ node, ...props }) => (
      <p className="mb-3 text-sm text-foreground" {...props} />
    ),
    ul: ({ node, ...props }) => (
      <ul className="list-disc pl-5 mb-3" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="list-decimal pl-5 mb-3" {...props} />
    ),
    li: ({ node, ...props }) => <li className="mb-1 text-sm" {...props} />,
    a: ({ href, children }) => (
      <a href={href} className="text-primary underline hover:opacity-80">
        {children}
      </a>
    ),
    code: ({ node, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || "");
      const isInline = props.inline || false;
      return !isInline ? (
        <pre className="block bg-muted p-4 rounded text-sm font-mono overflow-x-auto my-3">
          <code className={match ? className : ""} {...props}>
            {children}
          </code>
        </pre>
      ) : (
        <code
          className="bg-muted px-1 py-0.5 rounded text-sm font-mono"
          {...props}
        >
          {children}
        </code>
      );
    },
    blockquote: ({ node, ...props }) => (
      <blockquote
        className="border-l-4 border-border pl-4 italic my-3"
        {...props}
      />
    ),
    hr: () => <hr className="border-t border-border my-4" />,
    table: ({ node, ...props }) => (
      <table className="w-full border-collapse mb-4" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th
        className="border border-border bg-muted p-2 text-left font-semibold"
        {...props}
      />
    ),
    td: ({ node, ...props }) => (
      <td className="border border-border p-2 text-left" {...props} />
    ),
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="ml-2 inline-flex" tabIndex={tabIndex} aria-label="Help">
          <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-80">
        <div className="p-4">
          <Markdown components={markdownComponents}>{contentToShow}</Markdown>
        </div>
      </PopoverContent>
    </Popover>
  );
}
