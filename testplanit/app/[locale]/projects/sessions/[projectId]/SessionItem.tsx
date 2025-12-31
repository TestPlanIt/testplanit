import React from "react";
import { SessionsWithDetails } from "./SessionDisplay";
import { Button } from "@/components/ui/button";
import { MoreVertical, CheckCircle, LinkIcon } from "lucide-react";
import type { IconName } from "~/types/globals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DynamicIcon from "@/components/DynamicIcon";
import TextFromJson from "@/components/TextFromJson";
import { MemberList } from "@/components/MemberList";
import { Link } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { cn } from "~/utils";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { useTranslations } from "next-intl";
import { SessionResultsSummary } from "~/components/SessionResultsSummary";
import { useFindManySessionResults } from "~/lib/hooks";

interface SessionItemProps {
  testSession: SessionsWithDetails;
  isCompleted: boolean;
  onComplete: (testSession: SessionsWithDetails) => void;
  canComplete: boolean;
  isNew?: boolean;
  showMilestone?: boolean;
}

const SessionItem: React.FC<SessionItemProps> = ({
  testSession,
  isCompleted,
  onComplete,
  canComplete,
  isNew,
  showMilestone = true,
}) => {
  const { projectId } = useParams();
  const t = useTranslations();

  // Check if session has results to determine whether to display the summary
  const { data: sessionResults } = useFindManySessionResults({
    where: {
      sessionId: testSession.id,
      isDeleted: false,
    },
  });

  const hasResults = sessionResults && sessionResults.length > 0;

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
    "grid-cols-[minmax(0,1.5fr)_minmax(auto,1fr)_minmax(auto,1fr)_minmax(0,0.75fr)]";

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
        <div className="flex-1 min-w-0">
          <div className="min-w-0 w-full">
            <Link
              href={`/projects/sessions/${projectId}/${testSession.id}`}
              className="group inline-flex items-center gap-1 max-w-full"
            >
              <h3 className="text-md font-semibold flex items-center gap-1 hover:text-primary min-w-0">
                <DynamicIcon name="compass" className="min-w-6 min-h-6" />
                <span className="truncate inline-block">
                  {testSession.name}
                </span>
                <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </h3>
            </Link>
          </div>
          <div className="text-sm text-muted-foreground line-clamp-1">
            {testSession.note && (
              <TextFromJson
                jsonString={testSession.note as string}
                format="text"
                room={`session-note-${testSession.id}`}
                expand={false}
              />
            )}
          </div>
        </div>
      </div>

      {/* Middle Column 1 - Status */}
      <div className="flex min-w-28 whitespace-nowrap justify-start">
        <WorkflowStateDisplay {...workflowState} />
      </div>

      {/* Middle Column 2 - Results Summary */}
      <div className="flex items-center justify-start min-w-0">
        <SessionResultsSummary sessionId={testSession.id} className="w-full" />
      </div>

      {/* Right Column - MemberList & Actions */}
      <div className="flex items-center justify-end space-x-2 min-w-0">
        <div className="flex flex-col items-end gap-1.5 w-full">
          {isCompleted && showMilestone && testSession.milestone && (
            <MilestoneIconAndName milestone={testSession.milestone} />
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
        {!testSession.isCompleted && canComplete && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onComplete(testSession)}>
                  <div className="flex items-center">
                    <CheckCircle className="w-5 h-5 mr-2" />
                    {t("sessions.actions.complete")}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};

export default SessionItem;
