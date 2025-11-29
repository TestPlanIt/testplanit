import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyCaseFields } from "~/lib/hooks";
import { CaseFields } from "@prisma/client";
import { LayoutList } from "lucide-react";
interface CaseFieldListProps {
  caseFields: { caseFieldId: number }[];
  usePopover?: boolean;
}

export const CaseFieldListDisplay: React.FC<CaseFieldListProps> = ({
  caseFields,
  usePopover = true,
}) => {
  const { data: allCaseFields } = useFindManyCaseFields({
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
      <div className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)]">
        {allCaseFields.map((caseField: CaseFields) => (
          <Badge
            key={caseField.id}
            className=" border p-1 m-1 text-primary-foreground bg-primary rounded-xl items-center"
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
            <LayoutList className="w-4 h-4 mr-1" />
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
