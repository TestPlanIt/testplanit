import { LinkFavicon } from "@/components/LinkFavicon";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { Attachments } from "~/zenstack/models";
import { ExternalLink, File } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import { Link } from "~/lib/navigation";
import { highlightCode, mapLanguageToPrism } from "~/lib/utils/codeHighlight";
import { getStorageUrlClient } from "~/utils/storageUrl";
import "prismjs/themes/prism-tomorrow.css";

/** Flatten react-markdown code children into a raw string for highlighting. */
function codeToText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeToText).join("");
  return children == null ? "" : String(children);
}

interface AttachmentPreviewProps {
  attachment: Attachments;
  size?: "small" | "medium" | "large";
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachment,
  size = "small",
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [textContent, setTextContent] = useState<string | null>(null);
  // Convert MinIO URLs to proxy URLs for trial instances
  const fileURL = getStorageUrlClient(attachment.url) || attachment.url;
  const fileType = attachment.mimeType;

  useEffect(() => {
    if (fileType.startsWith("image/")) {
      const img = new window.Image();
      img.src = fileURL;
      img.onload = () => {
        setIsLoading(false);
      };
      img.onerror = () => {
        setIsLoading(false);
      };
    } else if (fileType.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = fileURL;
      video.onloadeddata = () => {
        setIsLoading(false);
      };
      video.onerror = () => {
        setIsLoading(false);
      };
    } else if (fileType.startsWith("text/uri")) {
      setIsLoading(false);
    } else if (fileType.startsWith("text/")) {
      fetch(fileURL)
        .then((response) => response.text())
        .then((text) => {
          setTextContent(text);
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [fileURL, fileType]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-24 w-24">
        <LoadingSpinner />
      </div>
    );
  }

  const getSizeClasses = (baseSize: number) => {
    const sizeMap = {
      small: baseSize,
      medium: baseSize * 2,
      large: baseSize * 3,
    };

    return {
      height: sizeMap[size],
      width: sizeMap[size],
    };
  };

  if (fileType.startsWith("image/")) {
    const { height, width } = getSizeClasses(100);
    // SVGs bypass next/image: the built-in optimizer refuses SVG unless
    // `images.dangerouslyAllowSVG` is enabled, and we don't want to opt into
    // that (SVG can carry inline <script>). Browsers don't execute scripts in
    // SVGs loaded via <img>, so plain <img> is the safe rendering path.
    const isSvg =
      fileType === "image/svg+xml" ||
      attachment.name.toLowerCase().endsWith(".svg");
    return (
      <div
        className="flex justify-center items-center max-h-[350px]"
        style={{ height, width }}
      >
        {isSvg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileURL}
            alt={attachment.name}
            height={height}
            width={width}
            className="object-contain"
          />
        ) : (
          <Image
            src={fileURL}
            alt={attachment.name}
            height={height}
            width={width}
            className="object-contain"
          />
        )}
      </div>
    );
  } else if (fileType === "application/pdf") {
    const { height: _height } = getSizeClasses(32);
    return (
      <iframe
        src={fileURL}
        className={`w-full h-full rounded-lg`}
        title={attachment.name}
      />
    );
  } else if (fileType.startsWith("text/uri")) {
    // Self-contained styling: explicit `text-foreground` + `bg-background` so
    // we don't inherit `text-primary` / `bg-accent` from wrappers like the
    // compact badge in AttachmentsListDisplay (which produced a low-contrast
    // violet pill across themes).
    const isLarge = size === "large";
    return (
      <Link
        href={fileURL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={fileURL}
        className={`inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-w-full ${
          isLarge ? "text-base" : "text-sm"
        }`}
      >
        <LinkFavicon
          url={fileURL}
          className={isLarge ? "w-5 h-5" : "w-4 h-4"}
        />
        <span className="truncate underline underline-offset-2">
          {attachment.name}
        </span>
        <ExternalLink
          className={`shrink-0 text-muted-foreground ${
            isLarge ? "w-4 h-4" : "w-3.5 h-3.5"
          }`}
        />
      </Link>
    );
  } else if (fileType.startsWith("text/")) {
    const { width } = getSizeClasses(250);
    const isMarkdown =
      fileType === "text/markdown" ||
      attachment.name.endsWith(".md") ||
      attachment.name.endsWith(".markdown");

    if (isMarkdown && textContent) {
      const markdownComponents: Components = {
        h1: ({ node, ...props }) => (
          <h1
            className="text-xl font-semibold mt-4 mb-2 text-primary"
            {...props}
          />
        ),
        h2: ({ node, ...props }) => (
          <h2
            className="text-lg font-semibold mt-3 mb-2 text-primary"
            {...props}
          />
        ),
        h3: ({ node, ...props }) => (
          <h3
            className="text-base font-semibold mt-2 mb-1 text-primary"
            {...props}
          />
        ),
        p: ({ node, ...props }) => (
          <div className="mb-3 text-sm text-foreground" {...props} />
        ),
        ul: ({ node, ...props }) => (
          <ul
            className="list-disc pl-5 mb-3 text-foreground marker:text-foreground"
            {...props}
          />
        ),
        ol: ({ node, ...props }) => (
          <ol
            className="list-decimal pl-5 mb-3 text-foreground marker:text-foreground"
            {...props}
          />
        ),
        li: ({ node, ...props }) => (
          <li className="mb-1 text-sm text-foreground" {...props} />
        ),
        a: ({ href, children }) => (
          <a href={href} className="text-primary underline hover:opacity-80">
            {children}
          </a>
        ),
        // Block fences render like QuickScript: PrismJS highlighting on a dark
        // background (prism-tomorrow). Inline code stays a small muted chip.
        code: ({ node, className, children, ...props }: any) => {
          const text = codeToText(children).replace(/\n$/, "");
          const match = /language-(\w+)/.exec(className || "");
          const isBlock = !!match || text.includes("\n");
          if (!isBlock) {
            return (
              <code
                className="bg-muted text-foreground px-1 py-0.5 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }
          const lang = match ? mapLanguageToPrism(match[1]) : null;
          return (
            <pre className="bg-stone-800 rounded-md overflow-auto p-4 text-sm my-3 max-w-full">
              {lang ? (
                <code
                  className={`language-${lang}`}
                  // Prism HTML-escapes the source, so this cannot inject markup.
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(text, lang),
                  }}
                />
              ) : (
                <code className="text-stone-100">{text}</code>
              )}
            </pre>
          );
        },
        // Unwrap react-markdown's default <pre>; the code component renders its own.
        pre: ({ children }: any) => <>{children}</>,
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
        strong: ({ node, ...props }) => (
          <strong className="font-semibold text-foreground" {...props} />
        ),
        em: ({ node, ...props }) => (
          <em className="italic text-foreground" {...props} />
        ),
      };

      return (
        <div
          className="w-fit border-2 border-primary/50 rounded-lg p-4 max-h-[650px] overflow-auto prose prose-sm dark:prose-invert bg-background"
          style={{ maxWidth: `${width}px` }}
        >
          <Markdown components={markdownComponents}>{textContent}</Markdown>
        </div>
      );
    }

    return (
      <pre
        className="w-fit border-2 border-primary/50 rounded-lg p-2 max-h-[650px] overflow-auto"
        style={{ maxWidth: `${width}px` }}
      >
        {textContent || attachment.name}
      </pre>
    );
  } else if (fileType.startsWith("video/")) {
    const { height } = getSizeClasses(32);
    return (
      <video
        src={fileURL}
        controls
        className="w-full max-h-full rounded-lg"
        style={{ height: `${height}px` }}
      />
    );
  } else if (fileType.startsWith("audio/")) {
    const { width } = getSizeClasses(200);
    return (
      <audio
        src={fileURL}
        controls
        className="min-h-[50px] rounded-lg"
        style={{ width: `${width}px` }}
      />
    );
  } else {
    const { height: _height, width } = getSizeClasses(100);
    return (
      <div
        className="flex flex-col items-center overflow-hidden max-h-fit"
        style={{
          width: `${width}px`,
        }}
      >
        <File className={`m-3 w-full h-fit text-primary`} />
        <span className="text-center truncate">{attachment.name}</span>
      </div>
    );
  }
};
