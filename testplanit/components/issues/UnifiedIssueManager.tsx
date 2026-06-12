"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IntegrationProvider } from "@prisma/client";
import { AlertCircle, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFindFirstProjects } from "~/lib/hooks";
import { Link } from "~/lib/navigation";
import { DeferredIssueManager } from "./DeferredIssueManager";
import { ManageExternalIssues } from "./ManageExternalIssues";
import { ManageSimpleUrlIssues } from "./ManageSimpleUrlIssues";

interface UnifiedIssueManagerProps {
  projectId: number;
  linkedIssueIds: number[];
  setLinkedIssueIds: (ids: number[]) => void;
  entityType?:
    | "testCase"
    | "testRun"
    | "session"
    | "testRunResult"
    | "testRunStepResult"
    | "sessionResult";
  entityId?: number;
  maxBadgeWidth?: string; // Tailwind max-width class for issue badges (e.g., "max-w-xs", "max-w-full")
  /**
   * INT-05: when the parent surface is Add Result on a parameterized
   * iteration, this carries the iteration identity so SearchIssuesDialog
   * can prefill Create New Issue with the iteration body builder's
   * output. Threaded through to ManageExternalIssues (committed entity)
   * or DeferredIssueManager (unsaved entity).
   */
  iterationContext?: {
    iterationId: number;
    testRunId: number;
    testRunCaseId: number;
  };
}

export function UnifiedIssueManager({
  projectId,
  linkedIssueIds,
  setLinkedIssueIds,
  entityType = "testCase",
  entityId,
  maxBadgeWidth,
  iterationContext,
}: UnifiedIssueManagerProps) {
  const t = useTranslations();

  // Fetch project with both old and new issue tracking config
  const { data: project, isLoading } = useFindFirstProjects({
    where: { id: projectId },
    include: {
      projectIntegrations: {
        where: { isActive: true },
        include: {
          integration: true,
        },
      },
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-muted rounded" />;
  }

  // Check for new integration system first
  const activeIntegration = project?.projectIntegrations?.[0];

  if (activeIntegration?.integration) {
    const integrationId =
      typeof activeIntegration.integration.id === "string"
        ? parseInt(activeIntegration.integration.id)
        : activeIntegration.integration.id;
    const projectIntegrationId =
      typeof activeIntegration.id === "string"
        ? parseInt(activeIntegration.id)
        : activeIntegration.id;

    // Handle SIMPLE_URL before the deferred branch — these issues carry a
    // manually entered externalId that the deferred create flow can't set,
    // and ManageSimpleUrlIssues already works for unsaved entities.
    if (
      activeIntegration.integration.provider === IntegrationProvider.SIMPLE_URL
    ) {
      // The URL template lives on Integration.settings, not ProjectIntegration.config
      const integrationSettings =
        (activeIntegration.integration.settings as Record<string, any>) || {};
      return (
        <ManageSimpleUrlIssues
          projectId={projectId}
          projectIntegrationId={projectIntegrationId}
          integrationId={integrationId}
          linkedIssueIds={linkedIssueIds}
          setLinkedIssueIds={setLinkedIssueIds}
          entityType={entityType}
          config={{
            baseUrl: integrationSettings.baseUrl as string | undefined,
          }}
        />
      );
    }

    // If entity doesn't exist yet (entityId is 0 or undefined), use deferred linking
    if (!entityId || entityId === 0) {
      return (
        <DeferredIssueManager
          projectId={projectId}
          selectedIssues={[]} // Not used anymore
          linkedIssueIds={linkedIssueIds}
          onIssuesChange={(issueIds) => {
            setLinkedIssueIds(issueIds);
          }}
          maxBadgeWidth={maxBadgeWidth}
          iterationContext={iterationContext}
        />
      );
    }

    // Use external integration system for other providers
    return (
      <ManageExternalIssues
        testCaseId={entityId || 0}
        projectId={projectId}
        projectIntegrationId={projectIntegrationId}
        integrationId={integrationId}
        provider={activeIntegration.integration.provider}
        linkedIssueIds={linkedIssueIds}
        setLinkedIssueIds={setLinkedIssueIds}
        entityType={entityType}
        iterationContext={iterationContext}
      />
    );
  }

  // No issue tracking configured
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>{t("common.errors.issueTrackerNotConfigured")}</span>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/settings/${projectId}/integrations`}>
            <Settings className="h-4 w-4" />
            {t("common.actions.edit")}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Simplified component for use in forms where we already have project data
 */
interface SimpleUnifiedIssueManagerProps extends Omit<
  UnifiedIssueManagerProps,
  "projectId"
> {
  projectData: {
    projectIntegrations?: Array<{
      id: string | number;
      isActive: boolean;
      integration: {
        id: string | number;
        name: string;
        provider: string;
      };
    }>;
  };
  projectId: number;
}

export function SimpleUnifiedIssueManager({
  projectData,
  projectId,
  linkedIssueIds,
  setLinkedIssueIds,
  entityType = "testCase",
  entityId,
}: SimpleUnifiedIssueManagerProps) {
  const t = useTranslations();

  // Check for new integration system first
  const activeIntegration = projectData.projectIntegrations?.find(
    (pi) => pi.isActive
  );

  if (activeIntegration) {
    const integrationId =
      typeof activeIntegration.integration.id === "string"
        ? parseInt(activeIntegration.integration.id)
        : activeIntegration.integration.id;
    const projectIntegrationId =
      typeof activeIntegration.id === "string"
        ? parseInt(activeIntegration.id)
        : activeIntegration.id;

    // Handle SIMPLE_URL before the deferred branch — these issues carry a
    // manually entered externalId that the deferred create flow can't set,
    // and ManageSimpleUrlIssues already works for unsaved entities.
    if (
      activeIntegration.integration.provider === IntegrationProvider.SIMPLE_URL
    ) {
      const integrationSettings =
        ((activeIntegration as any).integration?.settings as Record<
          string,
          any
        >) || {};
      return (
        <ManageSimpleUrlIssues
          projectId={projectId}
          projectIntegrationId={projectIntegrationId}
          integrationId={integrationId}
          linkedIssueIds={linkedIssueIds}
          setLinkedIssueIds={setLinkedIssueIds}
          entityType={entityType}
          config={{
            baseUrl: integrationSettings.baseUrl as string | undefined,
          }}
        />
      );
    }

    // If entity doesn't exist yet (entityId is 0 or undefined), use deferred linking
    if (!entityId || entityId === 0) {
      return (
        <DeferredIssueManager
          projectId={projectId}
          selectedIssues={[]} // Not used anymore
          linkedIssueIds={linkedIssueIds}
          onIssuesChange={(issueIds) => {
            setLinkedIssueIds(issueIds);
          }}
        />
      );
    }

    // Use external integration system for other providers
    return (
      <ManageExternalIssues
        testCaseId={entityId || 0}
        projectId={projectId}
        projectIntegrationId={projectIntegrationId}
        integrationId={integrationId}
        provider={activeIntegration.integration.provider}
        linkedIssueIds={linkedIssueIds}
        setLinkedIssueIds={setLinkedIssueIds}
        entityType={entityType}
      />
    );
  }

  // No issue tracking configured
  return (
    <Alert className="border-dashed">
      <AlertDescription className="text-sm text-muted-foreground">
        {t("common.errors.issueTrackerNotConfigured")}
      </AlertDescription>
    </Alert>
  );
}
