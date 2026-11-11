import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Folders } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { Link } from "~/lib/navigation";

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
  const tCommon = useTranslations("common");
  return (
    <Breadcrumb className="mb-2">
      <BreadcrumbList className="flex flex-wrap overflow-hidden">
        <Folders className="-me-1 h-4 w-4" />
        {breadcrumbItems.map((folder, index) => (
          <React.Fragment key={folder.id}>
            {index !== 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="m-0 p-0">
              {index === breadcrumbItems.length - 1 && !isLastClickable ? (
                <BreadcrumbPage className="overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger
                      type="button"
                      className="font-bold text-muted-foreground"
                    >
                      <div className="compact-button m-0 inline-flex max-w-xs cursor-pointer items-center p-0">
                        <span className="truncate">{folder.text}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div>{folder.text}</div>
                    </TooltipContent>
                  </Tooltip>
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  asChild
                  className="m-0 w-fit overflow-hidden p-0"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/projects/repository/${projectId}/?node=${folder.id}&view=folders`}
                        // Full opacity, not /50: primary at half strength is
                        // 3.4:1 on white and 2.3:1 in the purple theme, and the
                        // accessible themes already force `text-primary/*` back
                        // to full opacity in globals.css for this reason. The
                        // underline carries the "ancestor link" cue instead.
                        className="compact-button m-0 inline-flex max-w-xs cursor-pointer items-center p-0 text-primary hover:underline"
                        onClick={() => onClick && onClick(folder.id)}
                        aria-label={
                          folder.text?.trim()
                            ? folder.text
                            : tCommon("fields.folder")
                        }
                      >
                        <span className="truncate">{folder.text}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div>{folder.text}</div>
                    </TooltipContent>
                  </Tooltip>
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
