import { AttachmentPreview } from "@/components/AttachmentPreview";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Attachments } from "~/zenstack/models";
import { Paperclip } from "lucide-react";
import React, { useState } from "react";

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
          <Paperclip className="me-1 h-4 w-4" />
          {attachments.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent key={attachments.length}>
        <div
          className="flex max-h-[calc(100vh-400px)] flex-wrap items-center overflow-auto"
          onWheel={(e) => e.stopPropagation()}
        >
          {attachments.map((attachment, index) => (
            <div
              key={attachment.id}
              className="p-2"
              onClick={() => handleSelect(attachments, index)}
            >
              <Badge className="m-1 items-center rounded-sm border bg-accent p-1 text-primary">
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
