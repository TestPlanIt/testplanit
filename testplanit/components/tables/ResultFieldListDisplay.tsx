import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ResultFields } from "~/zenstack/models";
import { SquareCheck } from "lucide-react";
import React from "react";

interface ResultFieldListProps {
  resultFields: { resultFieldId: number }[];
  usePopover?: boolean;
}

export const ResultFieldListDisplay: React.FC<ResultFieldListProps> = ({
  resultFields,
  usePopover = true,
}) => {
  const { data: allResultFields } = useClientQueries(
    schema
  ).resultFields.useFindMany({
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
      <div className="flex max-h-[calc(100vh-400px)] flex-wrap items-center overflow-auto">
        {allResultFields.map((resultField: ResultFields) => (
          <Badge
            key={resultField.id}
            className=" m-1 items-center rounded-xl border bg-primary p-1 text-primary-foreground"
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
            <SquareCheck className="me-1 h-4 w-4" />
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
