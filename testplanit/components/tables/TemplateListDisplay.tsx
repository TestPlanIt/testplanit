import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyTemplates } from "~/lib/hooks";
import { Templates } from "@prisma/client";
import { LayoutTemplate } from "lucide-react";

interface TemplateListProps {
  templates: { templateId: number; templateName: string }[];
  usePopover?: boolean;
}

export const TemplateListDisplay: React.FC<TemplateListProps> = ({
  templates,
  usePopover = true,
}) => {
  const { data: allTemplates } = useFindManyTemplates({
    orderBy: { templateName: "asc" },
    where: {
      AND: [
        {
          id: {
            in: (templates || []).map((template) => template.templateId),
          },
        },
        { isDeleted: false },
      ],
    },
  });

  if (!allTemplates || allTemplates.length === 0) {
    return null;
  }

  const renderContent = () => (
    <>
      <div className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)]">
        {allTemplates.map((template: Templates) => (
          <Badge
            key={template.id}
            className=" border p-1 m-1 text-primary-foreground bg-primary rounded-xl items-center"
          >
            <div className="flex items-center gap-2">
              <div>{template?.templateName}</div>
            </div>
          </Badge>
        ))}
      </div>
    </>
  );

  if (usePopover) {
    return (
      <Popover>
        <PopoverTrigger>
          <Badge>
            <LayoutTemplate className="w-4 h-4 mr-1" />
            {allTemplates.length}
          </Badge>
        </PopoverTrigger>
        <PopoverContent>{renderContent()}</PopoverContent>
      </Popover>
    );
  } else {
    return <div>{renderContent()}</div>;
  }
};
