"use client";
import { determineTagDifferences } from "~/utils/determineTagDifferences";
import { DateFormatter } from "@/components/DateFormatter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import { AttachmentsDisplay } from "@/components/AttachmentsDisplay";
import {
  Attachments,
  SessionVersions,
  Workflows,
  FieldIcon,
  Color,
} from "@prisma/client";
import { IconName } from "~/types/globals";
import { toHumanReadable } from "~/utils/duration";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import DynamicIcon from "@/components/DynamicIcon";
import { useSession } from "next-auth/react";
import { TagDiffDisplay } from "./TagDiffDisplay";
import { useTranslations, useLocale } from "next-intl";
import { Minus, Plus } from "lucide-react";

type FieldType =
  | "state"
  | "user"
  | "estimate"
  | "duration"
  | "editor"
  | "tags"
  | "attachments"
  | "completed"
  | "text";

type WorkflowWithRelations = Workflows & {
  icon?: FieldIcon | null;
  color?: Color | null;
  projects?: {
    projectId: number;
    project: {
      name: string;
    };
  }[];
};

interface SessionVersionRendererProps {
  currentValue: any;
  previousValue: any;
  fieldType: FieldType;
  testSession: SessionVersions;
  field: string;
  workflows?: WorkflowWithRelations[];
  milestones?: {
    id: number;
    name: string;
    milestoneType: {
      icon: FieldIcon | null;
    } | null;
  }[];
  projectId?: number;
}

export function SessionVersionRenderer({
  currentValue,
  previousValue,
  fieldType,
  testSession,
  field,
  workflows,
  milestones,
  projectId,
}: SessionVersionRendererProps) {
  const { data: session } = useSession();
  const t = useTranslations();
  const locale = useLocale();

  const renderValue = (value: any, type: FieldType) => {
    switch (type) {
      case "text":
        const hasTextChanged =
          JSON.stringify(value) !== JSON.stringify(previousValue);
        const showTextDiff = hasTextChanged && previousValue !== undefined;

        const currentMilestone = milestones?.find((m) => m.name === value);
        const previousMilestone = milestones?.find(
          (m) => m.name === previousValue
        );
        const currentMilestoneIcon =
          currentMilestone?.milestoneType?.icon?.name || "milestone";
        const previousMilestoneIcon =
          previousMilestone?.milestoneType?.icon?.name || "milestone";

        const getCurrentIcon = () => (
          <DynamicIcon
            name={currentMilestoneIcon as IconName}
            className="h-4 w-4 shrink-0"
          />
        );

        const getPreviousIcon = () => (
          <DynamicIcon
            name={previousMilestoneIcon as IconName}
            className="h-4 w-4 shrink-0"
          />
        );

        const getIcon = () => {
          switch (field) {
            case t("sessions.version.fields.template"):
              return (
                <DynamicIcon name="layout-list" className="h-4 w-4 shrink-0" />
              );
            case t("sessions.version.fields.configuration"):
              return (
                <DynamicIcon name="combine" className="h-4 w-4 shrink-0" />
              );
            case t("sessions.version.fields.milestone"):
              return showTextDiff ? getPreviousIcon() : getCurrentIcon();
            default:
              return null;
          }
        };

        return (
          <div className="space-y-2">
            <div
              className={`text-sm flex items-start gap-1 ${
                showTextDiff ? "text-green-600 bg-green-100 p-2 rounded" : ""
              }`}
            >
              {showTextDiff && (
                <span>
                  <Plus className="w-4 h-4" />
                </span>
              )}
              {(field === "Template" ||
                field === "Configuration" ||
                field === "Milestone") &&
                (field === "Milestone" ? getCurrentIcon() : getIcon())}
              {value || t("sessions.version.renderer.none")}
            </div>
            {showTextDiff && (
              <div className="text-sm flex items-start gap-1 text-red-600 bg-red-100 p-2 rounded">
                <span>
                  <Minus className="w-4 h-4" />
                </span>
                {(field === "Template" ||
                  field === "Configuration" ||
                  field === "Milestone") &&
                  (field === "Milestone" ? getPreviousIcon() : getIcon())}
                {previousValue || t("sessions.version.renderer.none")}
              </div>
            )}
          </div>
        );

      case "state":
        const currentWorkflow = workflows?.find(
          (w) => w.id === testSession.stateId
        );
        const previousWorkflow = workflows?.find(
          (w) => w.name === previousValue
        );

        const hasStateChanged = currentValue !== previousValue;
        const showStateDiff = hasStateChanged && previousValue !== undefined;

        // Ensure we're using valid IconName type
        const defaultIcon: IconName = "circle";
        const currentIcon: IconName =
          (currentWorkflow?.icon?.name as IconName) || defaultIcon;
        const previousIcon: IconName =
          (previousWorkflow?.icon?.name as IconName) || defaultIcon;

        return (
          <div className="space-y-2">
            <div
              className={`text-sm flex items-start gap-1 ${
                showStateDiff ? "text-green-600 bg-green-100 p-2 rounded" : ""
              }`}
            >
              {showStateDiff && (
                <span>
                  <Plus className="w-4 h-4" />
                </span>
              )}
              <div className="flex items-center gap-1 truncate">
                <DynamicIcon
                  name={currentIcon}
                  className="h-4 w-4 shrink-0"
                  color={currentWorkflow?.color?.value}
                />
                <span className="truncate">{currentValue}</span>
              </div>
            </div>
            {showStateDiff && (
              <div className="text-sm flex items-start gap-1 text-red-600 bg-red-100 p-2 rounded">
                <span>
                  <Minus className="w-4 h-4" />
                </span>
                <div className="flex items-center gap-1 truncate">
                  <DynamicIcon
                    name={previousIcon}
                    className="h-4 w-4 shrink-0"
                    color={previousWorkflow?.color?.value}
                  />
                  <span className="truncate">{previousValue}</span>
                </div>
              </div>
            )}
          </div>
        );

      case "user":
        const hasUserChanged = value !== previousValue;
        const showUserDiff = hasUserChanged && previousValue !== undefined;
        return (
          <div className="space-y-2">
            <div
              className={`text-sm flex items-start gap-1 ${showUserDiff ? "text-green-600 bg-green-100 p-2 rounded" : ""}`}
            >
              {showUserDiff && (
                <span>
                  <Plus className="w-4 h-4" />
                </span>
              )}
              {value ? (
                <UserNameCell userId={value} />
              ) : (
                <div className="flex items-center gap-1">
                  <DynamicIcon name="user-round-x" className="h-4 w-4" />
                  {t("sessions.version.renderer.unassigned")}
                </div>
              )}
            </div>
            {showUserDiff && (
              <div className="text-sm flex items-start gap-1 text-red-600 bg-red-100 p-2 rounded">
                <span>
                  <Minus className="w-4 h-4" />
                </span>
                {previousValue ? (
                  <UserNameCell userId={previousValue} />
                ) : (
                  <div className="flex items-center gap-1">
                    <DynamicIcon name="user-round-x" className="h-4 w-4" />
                    {t("sessions.version.renderer.unassigned")}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "estimate":
        if (!value) {
          return (
            <span className="text-muted-foreground">
              {t("sessions.version.renderer.noEstimate")}
            </span>
          );
        }
        return (
          <span>
            {toHumanReadable(Number(value), {
              isSeconds: true,
              locale,
            })}
          </span>
        );

      case "duration":
        if (!value) {
          return (
            <span className="text-muted-foreground">
              {t("sessions.version.renderer.noTimeLogged")}
            </span>
          );
        }
        return (
          <span>
            {toHumanReadable(Number(value), {
              isSeconds: true,
              locale,
            })}
          </span>
        );

      case "editor":
        // Convert both values to strings for consistent comparison
        const currentString =
          typeof value === "string" ? value : JSON.stringify(value);
        const previousString =
          typeof previousValue === "string"
            ? previousValue
            : JSON.stringify(previousValue);

        const hasEditorChanged = currentString !== previousString;

        const showPreviousVersion = hasEditorChanged && previousValue;
        return value ? (
          <div
            className={`grid ${showPreviousVersion ? "grid-cols-2" : "grid-cols-1"} gap-4`}
          >
            <div>
              {showPreviousVersion && (
                <div className="font-medium text-sm mb-2 text-green-600">
                  {t("sessions.version.renderer.currentVersion")}
                </div>
              )}
              <div
                className={`min-h-fit max-h-[400px] overflow-y-auto border rounded-md p-2
                ${showPreviousVersion ? "bg-green-100" : ""}`}
              >
                <TipTapEditor
                  key={`current-${fieldType}-${testSession.id}`}
                  content={
                    typeof value === "string" ? JSON.parse(value) : value
                  }
                  readOnly={true}
                  className="h-auto"
                  projectId={projectId?.toString()}
                />
              </div>
            </div>
            {showPreviousVersion && (
              <div>
                <div className="font-medium text-sm mb-2 text-red-600">
                  <Minus className="w-4 h-4" />{" "}
                  {t("sessions.version.renderer.previousVersion")}
                </div>
                <div className="min-h-fit max-h-[400px] overflow-y-auto border rounded-md p-2 bg-red-100">
                  <TipTapEditor
                    key={`previous-${fieldType}-${testSession.id}`}
                    content={
                      typeof previousValue === "string"
                        ? JSON.parse(previousValue)
                        : previousValue
                    }
                    readOnly={true}
                    className="h-auto"
                    projectId={projectId?.toString()}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          t("sessions.version.renderer.noContent")
        );

      case "tags":
        interface TagObject {
          id: number;
          name: string;
        }

        // Parse the JSON strings into arrays and extract just the names for comparison
        const currentTags = Array.isArray(currentValue)
          ? currentValue.map((t: TagObject) => t.name)
          : JSON.parse(currentValue || "[]").map((t: TagObject) => t.name);
        const previousTags = Array.isArray(previousValue)
          ? previousValue.map((t: TagObject) => t.name)
          : JSON.parse(previousValue || "[]").map((t: TagObject) => t.name);

        const isFirstVersion = !previousValue || previousTags.length === 0;

        const { addedTags, removedTags, tCommonTags } = determineTagDifferences(
          currentTags,
          previousTags
        );

        return (
          <div className="flex flex-wrap max-w-full gap-1 mb-4">
            {!isFirstVersion &&
              addedTags.length > 0 &&
              addedTags.map((tag: string) => (
                <TagDiffDisplay
                  key={`added-${tag}`}
                  tag={tag}
                  type="added"
                  isFirstVersion={isFirstVersion}
                />
              ))}
            {tCommonTags.length > 0 &&
              tCommonTags.map((tag: string) => (
                <TagDiffDisplay
                  key={`common-${tag}`}
                  tag={tag}
                  type="common"
                  isFirstVersion={isFirstVersion}
                />
              ))}
            {!isFirstVersion &&
              removedTags.length > 0 &&
              removedTags.map((tag: string) => (
                <TagDiffDisplay
                  key={`removed-${tag}`}
                  tag={tag}
                  type="removed"
                  isFirstVersion={isFirstVersion}
                />
              ))}
          </div>
        );

      case "attachments":
        return (
          <AttachmentsDisplay
            preventEditing={true}
            attachments={currentValue as unknown as Attachments[]}
            previousAttachments={previousValue as unknown as Attachments[]}
            onSelect={() => {}}
          />
        );

      case "completed":
        if (!currentValue) return null;
        return (
          <Badge
            variant="secondary"
            className="flex items-center text-md whitespace-nowrap text-sm gap-1 p-2 px-4 bg-green-100 text-green-600"
          >
            <span>
              <Plus className="w-4 h-4" />
            </span>
            <DynamicIcon name="check-circle" className="h-6 w-6 shrink-0" />
            <div className="flex items-center truncate">
              <span className="mr-1">
                {t("sessions.version.renderer.completedOn")}
              </span>
              <span className="truncate">
                <DateFormatter
                  date={testSession.completedAt}
                  formatString={session?.user?.preferences?.dateFormat}
                  timezone={session?.user?.preferences?.timezone}
                />
              </span>
            </div>
          </Badge>
        );

      default:
        return <div className="text-sm">{value}</div>;
    }
  };

  const renderFieldLabel = () => {
    if (fieldType === "completed") {
      return "";
    }
    return field;
  };

  const hasChanged =
    JSON.stringify(currentValue) !== JSON.stringify(previousValue);

  return (
    <div className="space-y-2">
      {renderFieldLabel() && (
        <div className="font-medium text-sm">{renderFieldLabel()}</div>
      )}
      <div>{renderValue(currentValue, fieldType)}</div>
    </div>
  );
}
