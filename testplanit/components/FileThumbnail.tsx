import React from "react";
import { Attachments } from "@prisma/client";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FileThumbnailProps {
  attachment: Attachments;
}

const FileThumbnail: React.FC<FileThumbnailProps> = ({ attachment }) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger type="button" className="cursor-default">
          <Image
            src={attachment.url}
            alt={attachment.name}
            sizes="100vw"
            width={16}
            height={16}
            className="rounded-full"
          />
        </TooltipTrigger>
        <TooltipContent>
          <div>{attachment.name}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export { FileThumbnail };
