import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Attachments } from "~/zenstack/models";
import Image from "next/image";
import React from "react";

interface FileThumbnailProps {
  attachment: Attachments;
}

const FileThumbnail: React.FC<FileThumbnailProps> = ({ attachment }) => {
  // SVGs bypass next/image — the optimizer refuses SVG without
  // `dangerouslyAllowSVG`, which we deliberately avoid. Plain <img> is safe:
  // browsers don't run scripts in SVGs loaded that way.
  const isSvg =
    attachment.mimeType === "image/svg+xml" ||
    attachment.name.toLowerCase().endsWith(".svg");
  return (
    <Tooltip>
      <TooltipTrigger type="button" className="cursor-default">
        {isSvg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.name}
            width={16}
            height={16}
            className="rounded-full"
          />
        ) : (
          <Image
            src={attachment.url}
            alt={attachment.name}
            sizes="100vw"
            width={16}
            height={16}
            className="rounded-full"
          />
        )}
      </TooltipTrigger>
      <TooltipContent>
        <div>{attachment.name}</div>
      </TooltipContent>
    </Tooltip>
  );
};

export { FileThumbnail };
