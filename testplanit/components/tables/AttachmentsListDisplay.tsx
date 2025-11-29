import React, { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Attachments } from "@prisma/client";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { Paperclip } from "lucide-react";

interface AttachmentsListProps {
  attachments: Attachments[];
  onSelect: (attachments: Attachments[], index: number) => void;
}

export const AttachmentsListDisplay: React.FC<AttachmentsListProps> = ({
  attachments,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const handleSelect = (attachments: Attachments[], index: number) => {
    setOpen(false);
    onSelect(attachments, index);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge className="cursor-pointer">
          <Paperclip className="w-4 h-4 mr-1" />
          {attachments.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent key={attachments.length}>
        <div className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)]">
          {attachments.map((attachment, index) => (
            <div
              key={attachment.id}
              className="p-2"
              onClick={() => handleSelect(attachments, index)}
            >
              <Badge className="border p-1 m-1 text-primary bg-accent rounded-sm items-center">
                <div className="flex grow gap-2">
                  <AttachmentPreview attachment={attachment} size="small" />
                </div>
              </Badge>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
