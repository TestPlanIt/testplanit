import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyResultFields } from "~/lib/hooks";
import { ResultFields } from "@prisma/client";
import { SquareCheck } from "lucide-react";

interface ResultFieldListProps {
  resultFields: { resultFieldId: number }[];
  usePopover?: boolean;
}

export const ResultFieldListDisplay: React.FC<ResultFieldListProps> = ({
  resultFields,
  usePopover = true,
}) => {
  const { data: allResultFields } = useFindManyResultFields({
    orderBy: { displayName: "asc" },
    where: {
      AND: [
        {
          id: {
            in: (resultFields || []).map(
              (resultField) => resultField.resultFieldId
            ),
          },
          isDeleted: false,
        },
      ],
    },
  });

  if (!allResultFields || allResultFields.length === 0) {
    return null;
  }

  const renderContent = () => (
    <>
      <div className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)]">
        {allResultFields.map((resultField: ResultFields) => (
          <Badge
            key={resultField.id}
            className=" border p-1 m-1 text-primary-foreground bg-primary rounded-xl items-center"
          >
            <div className="flex items-center gap-2">
              <div>{resultField?.displayName}</div>
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
            <SquareCheck className="w-4 h-4 mr-1" />
            {allResultFields.length}
          </Badge>
        </PopoverTrigger>
        <PopoverContent>{renderContent()}</PopoverContent>
      </Popover>
    );
  } else {
    return <div>{renderContent()}</div>;
  }
};
