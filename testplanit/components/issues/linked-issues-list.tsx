"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ExternalLink,
  CirclePlus,
  Search,
  RefreshCw,
  Unlink,
  Link2,
  MoreVertical,
} from "lucide-react";
import { useFindManyIssue } from "@/lib/hooks/issue";
import { 
  useUpdateRepositoryCases,
  useUpdateSessions,
  useUpdateTestRuns,
  useUpdateTestRunResults,
  useUpdateTestRunStepResults,
  useUpdateSessionResults
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateIssueDialog } from "./create-issue-dialog";
import { SearchIssuesDialog } from "./search-issues-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LinkedIssuesListProps {
  projectId: number;
  entityType:
    | "testCase"
    | "session"
    | "sessionResult"
    | "testRun"
    | "testRunResult"
    | "testRunStepResult";
  entityId: number;
  showCreateButton?: boolean;
  showSearchButton?: boolean;
}

export function LinkedIssuesList({
  projectId,
  entityType,
  entityId,
  showCreateButton = true,
  showSearchButton = true,
}: LinkedIssuesListProps) {
  const t = useTranslations();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Get the update hooks for different entity types
  const { mutateAsync: updateRepositoryCase } = useUpdateRepositoryCases();
  const { mutateAsync: updateSession } = useUpdateSessions();
  const { mutateAsync: updateSessionResult } = useUpdateSessionResults();
  const { mutateAsync: updateTestRun } = useUpdateTestRuns();
  const { mutateAsync: updateTestRunResult } = useUpdateTestRunResults();
  const { mutateAsync: updateTestRunStepResult } = useUpdateTestRunStepResults();

  // Build the where clause based on entity type
  const whereClause: any = { projectId };
  switch (entityType) {
    case "testCase":
      whereClause.repositoryCases = { some: { id: entityId } };
      break;
    case "session":
      whereClause.sessions = { some: { id: entityId } };
      break;
    case "sessionResult":
      whereClause.sessionResults = { some: { id: entityId } };
      break;
    case "testRun":
      whereClause.testRuns = { some: { id: entityId } };
      break;
    case "testRunResult":
      whereClause.testRunResults = { some: { id: entityId } };
      break;
    case "testRunStepResult":
      whereClause.testRunStepResults = { some: { id: entityId } };
      break;
  }

  // Fetch linked issues
  const {
    data: issues,
    isLoading,
    refetch,
  } = useFindManyIssue({
    where: whereClause,
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
    refetch();
    toast({
      title: t("issues.refreshed"),
      description: t("issues.refreshedDescription"),
    });
  };

  const handleUnlinkIssue = async (issueId: number) => {
    try {
      // Update the entity to disconnect the issue
      switch (entityType) {
        case "testCase":
          await updateRepositoryCase({
            where: { id: entityId },
            data: {
              issues: {
                disconnect: { id: issueId }
              }
            }
          });
          break;
        case "session":
          await updateSession({
            where: { id: entityId },
            data: {
              issues: {
                disconnect: { id: issueId }
              }
            }
          });
          break;
        case "sessionResult":
          await updateSessionResult({
            where: { id: entityId },
            data: {
              issues: {
                disconnect: { id: issueId }
              }
            }
          });
          break;
        case "testRun":
          await updateTestRun({
            where: { id: entityId },
            data: {
              issues: {
                disconnect: { id: issueId }
              }
            }
          });
          break;
        case "testRunResult":
          await updateTestRunResult({
            where: { id: entityId },
            data: {
              issues: {
                disconnect: { id: issueId }
              }
            }
          });
          break;
        case "testRunStepResult":
          await updateTestRunStepResult({
            where: { id: entityId },
            data: {
              issues: {
                disconnect: { id: issueId }
              }
            }
          });
          break;
      }

      toast({
        title: t("issues.unlinked"),
        description: t("issues.unlinkedDescription"),
      });

      refetch();
    } catch (error) {
      console.error("Failed to unlink issue:", error);
      toast({
        title: t("common.errors.error"),
        description: t("issues.unlinkError"),
        variant: "destructive",
      });
    }
  };

  const handleIssueCreated = () => {
    refetch();
  };

  const handleIssueSelected = (issue: any) => {
    // Link the selected issue to the entity
    linkIssueToEntity(issue);
  };

  const linkIssueToEntity = async (issue: any) => {
    try {
      // Update the entity to connect the issue
      switch (entityType) {
        case "testCase":
          await updateRepositoryCase({
            where: { id: entityId },
            data: {
              issues: {
                connect: { id: issue.id }
              }
            }
          });
          break;
        case "session":
          await updateSession({
            where: { id: entityId },
            data: {
              issues: {
                connect: { id: issue.id }
              }
            }
          });
          break;
        case "sessionResult":
          await updateSessionResult({
            where: { id: entityId },
            data: {
              issues: {
                connect: { id: issue.id }
              }
            }
          });
          break;
        case "testRun":
          await updateTestRun({
            where: { id: entityId },
            data: {
              issues: {
                connect: { id: issue.id }
              }
            }
          });
          break;
        case "testRunResult":
          await updateTestRunResult({
            where: { id: entityId },
            data: {
              issues: {
                connect: { id: issue.id }
              }
            }
          });
          break;
        case "testRunStepResult":
          await updateTestRunStepResult({
            where: { id: entityId },
            data: {
              issues: {
                connect: { id: issue.id }
              }
            }
          });
          break;
      }

      toast({
        title: t("issues.linked"),
        description: t("issues.linkedDescription"),
      });

      refetch();
    } catch (error) {
      console.error("Failed to link issue:", error);
      toast({
        title: t("common.errors.error"),
        description: t("issues.linkError"),
        variant: "destructive",
      });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case "urgent":
      case "highest":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "high":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "low":
      case "lowest":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "open":
      case "new":
      case "todo":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "in progress":
      case "in_progress":
      case "doing":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "done":
      case "closed":
      case "resolved":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("issues.linkedIssues")}</CardTitle>
              <CardDescription>
                {t("issues.linkedIssuesDescription")}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                title={t("common.actions.refresh") as string}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              {showSearchButton && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSearchDialog(true)}
                >
                  <Search className=" h-4 w-4" />
                  {t("issues.searchAndLink")}
                </Button>
              )}
              {showCreateButton && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateDialog(true)}
                >
                  <CirclePlus className=" h-4 w-4" />
                  {t("issues.createAndLink")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : issues && issues.length > 0 ? (
            <div className="space-y-2">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start justify-between rounded-lg border p-3"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium">
                        {issue.externalKey && (
                          <span className="text-muted-foreground ">
                            {"["}
                            {issue.externalKey}
                            {"]"}
                          </span>
                        )}
                        {issue.title}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={getPriorityColor(issue.priority || "")}
                      >
                        {issue.priority}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={getStatusColor(issue.status || "")}
                      >
                        {issue.status}
                      </Badge>
                      {issue.createdBy && (
                        <span className="text-muted-foreground">
                          {issue.createdBy.name || issue.createdBy.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {issue.externalUrl && (
                        <DropdownMenuItem
                          onClick={() =>
                            issue.externalUrl &&
                            window.open(issue.externalUrl, "_blank")
                          }
                        >
                          <ExternalLink className="h-4 w-4" />
                          {t("issues.viewExternal")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleUnlinkIssue(issue.id)}
                        className="text-destructive"
                      >
                        <Unlink className="h-4 w-4" />
                        {t("issues.unlink")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <Link2 className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {t("issues.noLinkedIssues")}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {showSearchButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSearchDialog(true)}
                  >
                    <Search className=" h-4 w-4" />
                    {t("issues.searchAndLink")}
                  </Button>
                )}
                {showCreateButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreateDialog(true)}
                  >
                    <CirclePlus className=" h-4 w-4" />
                    {t("issues.createAndLink")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Issue Dialog */}
      <CreateIssueDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        projectId={projectId}
        entityType={entityType}
        entityId={entityId}
        onIssueCreated={handleIssueCreated}
      />

      {/* Search Issues Dialog */}
      <SearchIssuesDialog
        open={showSearchDialog}
        onOpenChange={setShowSearchDialog}
        projectId={projectId}
        multiSelect={false}
        onIssueSelected={handleIssueSelected}
      />
    </>
  );
}
