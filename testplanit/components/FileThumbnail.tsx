import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { Attachments } from "@prisma/client";
import Image from "next/image";
import React from "react";

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
