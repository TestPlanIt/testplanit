"use client";

import React from "react";
import { useFindFirstProjects } from "~/lib/hooks";
import { ManageExternalIssues } from "./ManageExternalIssues";
import { ManageSimpleUrlIssues } from "./ManageSimpleUrlIssues";
import { DeferredIssueManager } from "./DeferredIssueManager";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { IntegrationProvider } from "@prisma/client";

interface UnifiedIssueManagerProps {
  projectId: number;
  linkedIssueIds: number[];
  setLinkedIssueIds: (ids: number[]) => void;
  entityType?: 'testCase' | 'testRun' | 'session' | 'testRunResult' | 'testRunStepResult' | 'sessionResult';
  entityId?: number;
}

export function UnifiedIssueManager({
  projectId,
  linkedIssueIds,
  setLinkedIssueIds,
  entityType = 'testCase',
  entityId,
}: UnifiedIssueManagerProps) {
  const t = useTranslations();
  
  // Fetch project with both old and new issue tracking config
  const { data: project, isLoading } = useFindFirstProjects({
    where: { id: projectId },
    include: {
      projectIntegrations: {
        where: { isActive: true },
        include: { 
          integration: true
        }
      }
    }
  });

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-muted rounded" />;
  }

  // Check for new integration system first
  const activeIntegration = project?.projectIntegrations?.[0];
  
  // If entity doesn't exist yet (entityId is 0 or undefined), use deferred linking
  if (activeIntegration?.integration && (!entityId || entityId === 0)) {
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
  
  if (activeIntegration?.integration) {
    const integrationId = typeof activeIntegration.integration.id === 'string' 
      ? parseInt(activeIntegration.integration.id) 
      : activeIntegration.integration.id;
    const projectIntegrationId = typeof activeIntegration.id === 'string' 
      ? parseInt(activeIntegration.id) 
      : activeIntegration.id;

    // Handle SIMPLE_URL provider
    if (activeIntegration.integration.provider === IntegrationProvider.SIMPLE_URL) {
      return (
        <ManageSimpleUrlIssues
          projectId={projectId}
          projectIntegrationId={projectIntegrationId}
          integrationId={integrationId}
          linkedIssueIds={linkedIssueIds}
          setLinkedIssueIds={setLinkedIssueIds}
          entityType={entityType}
          config={activeIntegration.config as any}
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
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>{t("common.errors.issueTrackerNotConfigured")}</span>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/settings/${projectId}/integrations`}>
            <Settings className="h-4 w-4 mr-2" />
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
interface SimpleUnifiedIssueManagerProps extends Omit<UnifiedIssueManagerProps, 'projectId'> {
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
  entityType = 'testCase',
  entityId,
}: SimpleUnifiedIssueManagerProps) {
  const t = useTranslations();
  
  // Check for new integration system first
  const activeIntegration = projectData.projectIntegrations?.find(pi => pi.isActive);
  
  // If entity doesn't exist yet (entityId is 0 or undefined), use deferred linking
  if (activeIntegration && (!entityId || entityId === 0)) {
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
  
  if (activeIntegration) {
    const integrationId = typeof activeIntegration.integration.id === 'string' 
      ? parseInt(activeIntegration.integration.id) 
      : activeIntegration.integration.id;
    const projectIntegrationId = typeof activeIntegration.id === 'string' 
      ? parseInt(activeIntegration.id) 
      : activeIntegration.id;

    // Handle SIMPLE_URL provider
    if (activeIntegration.integration.provider === IntegrationProvider.SIMPLE_URL) {
      return (
        <ManageSimpleUrlIssues
          projectId={projectId}
          projectIntegrationId={projectIntegrationId}
          integrationId={integrationId}
          linkedIssueIds={linkedIssueIds}
          setLinkedIssueIds={setLinkedIssueIds}
          entityType={entityType}
          config={(activeIntegration as any).config}
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