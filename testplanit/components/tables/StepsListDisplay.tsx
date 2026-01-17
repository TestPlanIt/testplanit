import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Steps as PrismaSteps } from "@prisma/client";
import { ListOrdered, SearchCheck, Layers } from "lucide-react";
import TextFromJson from "@/components/TextFromJson";
import { useFindManySharedStepItem } from "~/lib/hooks";
import { useTranslations } from "next-intl";
import { emptyEditorContent } from "~/app/constants";

interface ListDisplayStep extends PrismaSteps {
  sharedStepGroupId: number | null;
  sharedStepGroup?: { name: string | null } | null;
}

interface StepsListProps {
  steps: ListDisplayStep[];
}

interface RenderSharedGroupInListProps {
  sharedStepGroupId: number;
}

const RenderSharedGroupInList: React.FC<RenderSharedGroupInListProps> = ({
  sharedStepGroupId,
}) => {
  const t = useTranslations("repository.steps");
  const { data: items, isLoading } = useFindManySharedStepItem(
    {
      where: {
        sharedStepGroupId,
        sharedStepGroup: { isDeleted: false },
      },
      orderBy: { order: "asc" },
    },
    { enabled: !!sharedStepGroupId }
  );

  if (isLoading) {
    return (
      <li className="ml-4 text-sm text-muted-foreground py-1">
        {t("loadingSharedStepsItems")}
      </li>
    );
  }

  if (!items || items.length === 0) {
    return (
      <li className="ml-4 text-sm text-muted-foreground py-1">
        {t("noStepsInSharedGroup")}
      </li>
    );
  }

  return (
    <ol className="list-decimal overflow-hidden w-full pl-4">
      {items.map((item, itemIndex) => {
        const stepContentString = item.step
          ? typeof item.step === "string"
            ? item.step
            : JSON.stringify(item.step)
          : JSON.stringify(emptyEditorContent);

        const expectedResultString = item.expectedResult
          ? typeof item.expectedResult === "string"
            ? item.expectedResult
            : JSON.stringify(item.expectedResult)
          : JSON.stringify(emptyEditorContent);

        return (
          <li key={item.id || itemIndex} className="mb-2">
            <div className="truncate font-semibold">
              <TextFromJson
                jsonString={stepContentString}
                room={`shared-list-${sharedStepGroupId}-item-${item.id || itemIndex}-step`}
              />
            </div>
            <div className="text-sm flex items-center gap-1 truncate mt-1">
              <SearchCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              <TextFromJson
                jsonString={expectedResultString}
                room={`shared-list-${sharedStepGroupId}-item-${item.id || itemIndex}-expected`}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export const StepsListDisplay: React.FC<StepsListProps> = ({ steps }) => {
  const t = useTranslations();

  if (!steps || steps.length === 0) {
    return null;
  }

  const sortedSteps = steps.slice().sort((a, b) => a.order - b.order);

  return (
    <Popover>
      <PopoverTrigger>
        <Badge>
          <ListOrdered className="w-4 h-4 mr-1" />
          {sortedSteps.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)] lg:w-[400px]">
        <ol className="pl-6 overflow-hidden w-full list-decimal">
          {sortedSteps.map((step, index) => {
            if (step.sharedStepGroupId) {
              return (
                <li key={`shared-group-${step.id || index}`}>
                  <div className="font-bold truncate flex items-center mb-1">
                    <div className="flex items-center">
                      <Layers
                        size={16}
                        className="mr-2 text-primary shrink-0"
                      />
                      {step.sharedStepGroup?.name || t("common.fields.steps")}
                      <span className="text-xs text-muted-foreground ml-1">
                        {t("repository.steps.sharedGroupSuffix")}
                      </span>
                    </div>
                  </div>
                  <RenderSharedGroupInList
                    sharedStepGroupId={step.sharedStepGroupId}
                  />
                </li>
              );
            }

            const expectedResultString = step.expectedResult
              ? typeof step.expectedResult === "string"
                ? step.expectedResult
                : JSON.stringify(step.expectedResult)
              : JSON.stringify(emptyEditorContent);

            return (
              <li
                key={step.id || `step-${index}`}
                className="mb-2 list-decimal"
              >
                <div className="font-bold truncate">
                  <TextFromJson
                    jsonString={
                      typeof step.step === "string"
                        ? step.step
                        : JSON.stringify(step.step)
                    }
                    room={(step.id || `step-${index}`).toString()}
                  />
                </div>
                <div className="text-sm flex items-center gap-1">
                  <SearchCheck className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    <TextFromJson
                      jsonString={expectedResultString}
                      room={
                        (step.id || `step-${index}`).toString() + "-expected"
                      }
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
};
