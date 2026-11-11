import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CaseFields } from "~/zenstack/models";
import { LayoutList } from "lucide-react";
import React from "react";
interface CaseFieldListProps {
  caseFields: { caseFieldId: number }[];
  usePopover?: boolean;
}

export const CaseFieldListDisplay: React.FC<CaseFieldListProps> = ({
  caseFields,
  usePopover = true,
}) => {
  const { data: allCaseFields } = useClientQueries(
    schema
  ).caseFields.useFindMany({
    orderBy: { displayName: "asc" },
    where: {
      AND: [
        {
          id: {
            in: (caseFields || []).map((caseField) => caseField.caseFieldId),
          },
        },
        { isDeleted: false },
      ],
    },
  });

  if (!allCaseFields || allCaseFields.length === 0) {
    return null;
  }

  const renderContent = () => (
    <>
      <div className="flex max-h-[calc(100vh-400px)] flex-wrap items-center overflow-auto">
        {allCaseFields.map((caseField: CaseFields) => (
          <Badge
            key={caseField.id}
            className=" m-1 items-center rounded-xl border bg-primary p-1 text-primary-foreground"
          >
            <div className="flex items-center gap-2">
              <div>{caseField?.displayName}</div>
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
            <LayoutList className="me-1 h-4 w-4" />
            {allCaseFields.length}
          </Badge>
        </PopoverTrigger>
        <PopoverContent>{renderContent()}</PopoverContent>
      </Popover>
    );
  } else {
    return <div>{renderContent()}</div>;
  }
};
