import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Templates } from "~/zenstack/models";
import { LayoutTemplate } from "lucide-react";
import React from "react";

interface TemplateListProps {
  templates: { templateId: number; templateName: string }[];
  usePopover?: boolean;
}

export const TemplateListDisplay: React.FC<TemplateListProps> = ({
  templates,
  usePopover = true,
}) => {
  const { data: allTemplates } = useClientQueries(schema).templates.useFindMany(
    {
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
    }
  );

  if (!allTemplates || allTemplates.length === 0) {
    return null;
  }

  const renderContent = () => (
    <>
      <div className="flex max-h-[calc(100vh-400px)] flex-wrap items-center overflow-auto">
        {allTemplates.map((template: Templates) => (
          <Badge
            key={template.id}
            className=" m-1 items-center rounded-xl border bg-primary p-1 text-primary-foreground"
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
            <LayoutTemplate className="me-1 h-4 w-4" />
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
