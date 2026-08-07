import { DateTextDisplay } from "@/components/DateTextDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { MemberList } from "@/components/MemberList";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import {
  PendingReviewBadge,
  type PendingReviewSummary,
} from "@/components/reviews/PendingReviewBadge";
import TextFromJson from "@/components/TextFromJson";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { ApplicationArea } from "~/zenstack/models";
import {
  CheckCircle,
  Combine,
  CopyPlus,
  Flame,
  LinkIcon,
  MoreVertical,
  Pencil,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import React from "react";
import { SessionResultsSummary } from "~/components/SessionResultsSummary";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { Link, useRouter } from "~/lib/navigation";
import type { IconName } from "~/types/globals";
import { cn } from "~/utils";
import { RecordKeyMenuItem } from "@/components/RecordKeyMenuItem";

/**
 * The narrowest session shape this row renders. Declared structurally rather
 * than as the sessions page's `SessionsWithDetails` so any page that can
 * select these fields — the sessions list, the project overview panel — gets
 * the same row instead of hand-rolling its own markup.
 */
export interface SessionItemData {
  id: number;
  name: string;
  isCompleted: boolean;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
  note?: unknown;
  configurationGroupId?: string | null;
  configuration?: { name: string } | null;
  state: {
    name: string;
    icon?: { name: string } | null;
    color?: { value: string } | null;
  };
  createdBy: { id: string };
  assignedTo?: { id: string } | null;
  milestone?:
    React.ComponentProps<typeof MilestoneIconAndName>["milestone"] | null;
}

interface SessionItemProps<T extends SessionItemData> {
  testSession: T;
  isCompleted: boolean;
  onComplete?: (testSession: T) => void;
  onDuplicate?: (session: { id: number; name: string }) => void;
  canComplete?: boolean;
  canEdit?: boolean;
  canDuplicate?: boolean;
  isNew?: boolean;
  showMilestone?: boolean;
  /** Falls back to the route param; pass it where the route isn't the
   *  sessions page (e.g. the project overview panel). */
  projectId?: number;
  /** Set false for read-only surfaces that shouldn't offer row actions. */
  showActions?: boolean;
  /**
   * Pre-fetched PENDING ReviewRequest for this row's entity (bulk-loaded by
   * the parent SessionDisplay; see RESEARCH §"Pitfall 6"). `undefined` means
   * no pending review for this row.
   */
  pendingRequest?: PendingReviewSummary;
  /** Multi-select support: shows a leading checkbox when provided. */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}

const SessionItem = <T extends SessionItemData>({
  testSession,
  isCompleted,
  onComplete,
  onDuplicate,
  canComplete = false,
  canEdit,
  canDuplicate,
  isNew,
  showMilestone = true,
  projectId: projectIdProp,
  showActions = true,
  pendingRequest,
  selectable = false,
  selected = false,
  onSelectedChange,
}: SessionItemProps<T>) => {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations();

  // Fetch permissions
  const numericProjectId =
    projectIdProp ?? parseInt(params.projectId as string, 10);
  const { permissions: sessionPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.Sessions);
  const canEditSession = canEdit ?? sessionPermissions?.canAddEdit ?? false;

  // Determine if menu items should be shown
  const showEditItem =
    canEditSession && !testSession.isCompleted && !isLoadingPermissions;
  const showCompleteItem = !testSession.isCompleted && canComplete;
  const showDuplicateItem = canDuplicate ?? canEditSession;
  const showMoreMenu =
    showActions && (showEditItem || showCompleteItem || showDuplicateItem);

  // `note` arrives as a JSON column; render the string form.
  const noteText =
    typeof testSession.note === "string"
      ? testSession.note
      : testSession.note
        ? JSON.stringify(testSession.note)
        : undefined;

  const isRecentlyCreated =
    !!testSession.createdAt &&
    Date.now() - new Date(testSession.createdAt).getTime() < 5 * 60 * 1000;

  // Transform state data to match WorkflowStateDisplay expectations
  const workflowState = {
    state: {
      name: testSession.state.name,
      icon: {
        name: testSession.state.icon?.name as IconName,
      },
      color: {
        value: testSession.state.color?.value || "",
      },
    },
  };

  // Create users array for MemberList with prepend text
  const users = [
    {
      userId: testSession.createdBy.id,
      prependText: t("common.fields.createdBy"),
    },
    ...(testSession.assignedTo
      ? [
          {
            userId: testSession.assignedTo.id,
            prependText: t("common.fields.assignedTo"),
          },
        ]
      : []),
  ];

  // Using consistent grid layout for all items
  const gridLayout =
    "grid-cols-[minmax(0,1.5fr)_minmax(auto,0.75fr)_minmax(auto,0.75fr)_minmax(auto,1fr)_minmax(0,1fr)]";

  return (
    <div
      id={`session-${testSession.id}`}
      className={cn(
        `overflow-hidden relative grid ${gridLayout} gap-4 items-center w-full my-2 p-2 border-4 rounded-lg shadow-xs`,
        isNew && "border-primary animate-pulse"
      )}
      style={{
        backgroundColor: testSession.state.color?.value
          ? `${testSession.state.color.value}10`
          : undefined,
        borderColor: testSession.state.color?.value
          ? isNew
            ? testSession.state.color.value
            : `${testSession.state.color.value}44`
          : undefined,
      }}
    >
      {/* Left Column - Name & Note */}
      <div className="flex items-center min-w-0">
        {selectable && (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectedChange?.(checked === true)}
            aria-label={t("common.bulk.selectItem")}
            className="me-2 shrink-0"
            data-testid={`session-select-${testSession.id}`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center min-w-0 w-full">
            <Link
              href={`/projects/sessions/${numericProjectId}/${testSession.id}`}
              className="group inline-flex items-center gap-1 min-w-0 max-w-full"
            >
              <h3 className="text-sm font-semibold flex items-center gap-1 hover:text-primary min-w-0">
                {isRecentlyCreated && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Flame className="h-4 w-4 shrink-0 text-orange-500 fill-orange-500 animate-pulse" />
                    </TooltipTrigger>
                    <TooltipContent>{t("common.labels.new")}</TooltipContent>
                  </Tooltip>
                )}
                <DynamicIcon name="compass" className="h-5 w-5 shrink-0" />
                <span className="truncate inline-block">
                  {testSession.name}
                </span>
                {testSession.configurationGroupId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0">
                        <Combine className="w-4 h-4 text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-background/50">
                        {t("common.labels.multiConfiguration")}
                      </p>
                      {testSession.configuration && (
                        <p className="flex text-xs text-background">
                          <Combine className="w-4 h-4 shrink-0 me-1" />
                          {testSession.configuration.name}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
                <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </h3>
            </Link>
            <div className="flex items-center ms-1 shrink-0">
              <PendingReviewBadge pendingRequest={pendingRequest} />
            </div>
          </div>
          <div className="text-sm text-muted-foreground line-clamp-1">
            {noteText && (
              <TextFromJson
                jsonString={noteText}
                format="text"
                room={`session-note-${testSession.id}`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Configuration Column */}
      <div className="flex items-center min-w-0">
        {testSession.configuration ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 text-sm text-muted-foreground truncate cursor-default">
                <Combine className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {testSession.configuration.name}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="flex">
                <Combine className="w-4 h-4 shrink-0 me-1" />
                {testSession.configuration.name}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {/* Status */}
      <div className="flex min-w-28 whitespace-nowrap justify-start">
        <WorkflowStateDisplay {...workflowState} size="sm" />
      </div>

      {/* Middle Column 2 - Results Summary */}
      <div className="flex items-center justify-start min-w-0">
        <SessionResultsSummary sessionId={testSession.id} className="w-full" />
      </div>

      {/* Right Column - MemberList & Actions */}
      <div className="flex items-center justify-end space-x-2 min-w-0">
        <div className="flex flex-col items-end gap-1.5 w-full min-w-0">
          {showMilestone && testSession.milestone && (
            <div className="max-w-full min-w-0 overflow-hidden">
              <MilestoneIconAndName milestone={testSession.milestone} />
            </div>
          )}
          {isCompleted && testSession.completedAt && (
            <DateTextDisplay
              endDate={new Date(testSession.completedAt)}
              isCompleted={true}
            />
          )}

          {/* MemberList */}
          {!isCompleted && (
            <div className="w-full flex justify-end">
              <MemberList users={users} />
            </div>
          )}
        </div>
        {showMoreMenu && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t("common.actions.actionsLabel")}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                {showEditItem && (
                  <DropdownMenuItem
                    onClick={() =>
                      router.push(
                        `/projects/sessions/${numericProjectId}/${testSession.id}?edit=true`
                      )
                    }
                    data-testid={`session-edit-${testSession.id}`}
                  >
                    <Pencil className="me-2 h-4 w-4" />
                    {t("common.actions.edit")}
                  </DropdownMenuItem>
                )}

                {showDuplicateItem && (
                  <DropdownMenuItem
                    onClick={() =>
                      onDuplicate &&
                      onDuplicate({
                        id: testSession.id,
                        name: testSession.name,
                      })
                    }
                    data-testid={`session-duplicate-${testSession.id}`}
                  >
                    <CopyPlus className="me-2 h-4 w-4" />
                    {t("common.actions.duplicate")}
                  </DropdownMenuItem>
                )}

                {showCompleteItem && (
                  <DropdownMenuItem onSelect={() => onComplete?.(testSession)}>
                    <CheckCircle className="me-2 h-4 w-4" />
                    {t("sessions.actions.complete")}
                  </DropdownMenuItem>
                )}
                <RecordKeyMenuItem
                  type="SESSION"
                  id={testSession.id}
                  projectId={numericProjectId}
                />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};

export default SessionItem;
