import React from "react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link } from "~/lib/navigation";
import { Folders } from "lucide-react";

interface FolderNode {
  id: number;
  text: string;
  parent: number | string;
}

interface BreadcrumbComponentProps {
  breadcrumbItems: FolderNode[];
  projectId: string | number;
  onClick?: (folderId: number) => void; // Add optional click handler for breadcrumb items
  isLastClickable?: boolean; // Add option to make the last item clickable
}

const BreadcrumbComponent: React.FC<BreadcrumbComponentProps> = ({
  breadcrumbItems,
  projectId,
  onClick,
  isLastClickable = true,
}) => {
  return (
    <Breadcrumb className="mb-2">
      <BreadcrumbList className="flex overflow-hidden flex-wrap">
        <Folders className="w-4 h-4 -mr-1" />
        {breadcrumbItems.map((folder, index) => (
          <React.Fragment key={folder.id}>
            {index !== 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="p-0 m-0">
              {index === breadcrumbItems.length - 1 && !isLastClickable ? (
                <BreadcrumbPage className="overflow-hidden">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger type="button" className="text-muted-foreground font-bold">
                        <div className="cursor-pointer inline-flex items-center p-0 m-0 max-w-xs compact-button">
                          <span className="truncate">{folder.text}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div>{folder.text}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  asChild
                  className="p-0 m-0 overflow-hidden w-fit"
                >
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger type="button">
                        <Link
                          href={`/projects/repository/${projectId}/?node=${folder.id}`}
                          className="text-primary/50 cursor-pointer inline-flex items-center p-0 m-0 max-w-xs compact-button hover:underline"
                          onClick={() => onClick && onClick(folder.id)}
                          type="button"
                        >
                          <span className="truncate">{folder.text}</span>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div>{folder.text}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export default BreadcrumbComponent;
