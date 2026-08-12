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
import { ItemRow, ItemRowChip } from "@/components/ItemRow";
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
import { useSessionResultWindow } from "~/hooks/useResultWindow";
import { useRouter } from "~/lib/navigation";
import type { IconName } from "~/types/globals";
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

  // Execution window, read from the same summary the results bar below renders.
  const { startDate, endDate } = useSessionResultWindow({
    sessionId: testSession.id,
    isCompleted: testSession.isCompleted,
  });

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

  return (
    <ItemRow
      id={`session-${testSession.id}`}
      href={`/projects/sessions/${numericProjectId}/${testSession.id}`}
      prefetch={false}
      name={testSession.name}
      accentColor={testSession.state.color?.value}
      isNew={isNew}
      selectable={selectable}
      selected={selected}
      onSelectedChange={onSelectedChange}
      selectTestId={`session-select-${testSession.id}`}
      icon={<DynamicIcon name="compass" className="h-5 w-5 shrink-0" />}
      adornments={[
        {
          key: "review",
          content: <PendingReviewBadge pendingRequest={pendingRequest} />,
        },
        isRecentlyCreated && {
          key: "new",
          tier: "md",
          content: (
            <Tooltip>
              <TooltipTrigger asChild>
                <Flame className="h-4 w-4 shrink-0 text-orange-500 fill-orange-500 animate-pulse" />
              </TooltipTrigger>
              <TooltipContent>{t("common.labels.new")}</TooltipContent>
            </Tooltip>
          ),
        },
        testSession.configurationGroupId && {
          key: "multi-config",
          tier: "sm",
          content: (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="shrink-0"
                  data-testid={`session-multi-config-${testSession.id}`}
                >
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
          ),
        },
        {
          key: "open",
          tier: "lg",
          content: (
            <LinkIcon className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          ),
        },
      ]}
      identityChips={[
        startDate && {
          // Pinned, so it renders after the shrinking chips and immediately
          // before the state badge. A clipped date range is unreadable, so it
          // collapses whole once the row is too narrow to seat it; the year
          // drops first, below @2xl.
          key: "dates",
          tier: "md",
          pinned: true,
          content: (
            <span className="whitespace-nowrap text-sm">
              <DateTextDisplay
                responsive
                startDate={startDate}
                endDate={endDate}
                // A lone start date reads as a bare timestamp; a range doesn't
                // need telling.
                startLabel={endDate ? undefined : t("common.fields.started")}
              />
            </span>
          ),
        },
        testSession.configuration && {
          key: "configuration",
          tier: "md",
          content: (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 cursor-default">
                  <ItemRowChip icon={<Combine className="w-4 h-4" />}>
                    {testSession.configuration.name}
                  </ItemRowChip>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="flex">
                  <Combine className="w-4 h-4 shrink-0 me-1" />
                  {testSession.configuration.name}
                </p>
              </TooltipContent>
            </Tooltip>
          ),
        },
      ]}
      state={<WorkflowStateDisplay {...workflowState} size="sm" />}
      actions={
        showMoreMenu && (
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
        )
      }
      chips={[
        showMilestone &&
          testSession.milestone && {
            key: "milestone",
            tier: "lg",
            content: <MilestoneIconAndName milestone={testSession.milestone} />,
          },
      ]}
      metaTrailing={[
        !isCompleted && {
          key: "members",
          tier: "xl",
          content: <MemberList users={users} />,
        },
      ]}
      progress={
        <SessionResultsSummary sessionId={testSession.id} className="w-full" />
      }
      note={
        noteText && (
          <TextFromJson
            jsonString={noteText}
            format="text"
            room={`session-note-${testSession.id}`}
          />
        )
      }
    />
  );
};

export default SessionItem;
