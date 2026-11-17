"use client";

import { CreateIssueDialog } from "@/components/issues/create-issue-dialog";
import { CreateIssueJiraForm } from "@/components/issues/create-issue-jira-form";
import { SearchIssuesDialog } from "@/components/issues/search-issues-dialog";
import { Button } from "@/components/ui/button";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { schema } from "~/zenstack/schema";

/** The shape the issue dialogs hand back for internal and external picks. */
interface PickedIssue {
  id: number | string;
  internalId?: number;
  isExternal?: boolean;
  externalId?: string;
  key?: string;
  externalKey?: string;
  title: string;
  externalUrl?: string;
  url?: string;
  externalStatus?: string;
  status?: string | { name?: string };
}

export interface SignatureIssueDraft {
  title: string;
  description: Record<string, unknown>;
}

interface SignatureIssueLinkerProps {
  signatureId: number;
  projectId: number;
  linkedIssueIds: number[];
  onLinked?: () => void;
  /** "link" opens the search dialog; "create" opens the tracker's create form pre-filled with `draft`. */
  mode?: "link" | "create";
  draft?: SignatureIssueDraft;
  size?: "sm" | "default";
}

/**
 * Links an issue to a failure signature. An internal issue links directly;
 * an external one is first upserted into the project's issue shell (same
 * flow as milestone members), then joined through FailureSignatureIssue.
 */
export function SignatureIssueLinker({
  signatureId,
  projectId,
  linkedIssueIds,
  onLinked,
  mode = "link",
  draft,
  size = "sm",
}: SignatureIssueLinkerProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queries = useClientQueries(schema);
  const { mutateAsync: link } = queries.failureSignatureIssue.useCreate();
  const { mutateAsync: upsertIssue } = queries.issue.useUpsert();
  const { data: projectIntegrations } = queries.projectIntegration.useFindMany({
    where: { projectId, isActive: true },
    include: { integration: true },
  });
  const activeIntegration = projectIntegrations?.[0];

  const handleSelected = async (issue: PickedIssue) => {
    setBusy(true);
    try {
      let issueId: number;
      const statusName =
        typeof issue.status === "object" ? issue.status?.name : issue.status;
      if (issue.internalId) {
        issueId = issue.internalId;
      } else if (issue.isExternal || issue.key || issue.url) {
        const integrationId = activeIntegration?.integrationId;
        if (!integrationId) {
          throw new Error("No active integration to resolve external issue");
        }
        const externalId = String(issue.externalId || issue.id);
        const resolved = await upsertIssue({
          where: { externalId_integrationId: { externalId, integrationId } },
          create: {
            name: issue.key || issue.externalKey || externalId,
            title: issue.title,
            externalId,
            externalKey: issue.externalKey || issue.key,
            externalUrl: issue.externalUrl || issue.url,
            externalStatus: issue.externalStatus || statusName,
            status: statusName,
            integration: { connect: { id: integrationId } },
            project: { connect: { id: projectId } },
          } as never,
          update: {
            title: issue.title,
            externalUrl: issue.externalUrl || issue.url,
            externalStatus: issue.externalStatus || statusName,
          },
        });
        issueId = resolved.id;
      } else {
        issueId = Number(issue.id);
      }
      await link({ data: { signatureId, issueId } });
      toast.success(t("triage.toasts.issueLinked"));
      setOpen(false);
      onLinked?.();
    } catch (error) {
      console.error("Failed to link issue to signature:", error);
      toast.error(t("triage.toasts.updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  // A created issue is linked while it is created (route `failureSignatureId`
  // for the tracker form, `failureSignatures` create data for the internal
  // dialog), so here we only close and refresh.
  const handleCreated = () => {
    toast.success(t("triage.toasts.issueLinked"));
    setOpen(false);
    onLinked?.();
  };

  const isCreate = mode === "create";
  const defaults = draft
    ? { title: draft.title, description: draft.description }
    : undefined;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        disabled={busy}
        data-testid={
          isCreate ? "triage-create-issue-button" : "triage-link-issue-button"
        }
      >
        <Plus className="h-4 w-4" />
        {isCreate ? t("issues.createIssue") : t("issues.linkIssue")}
      </Button>
      {open && !isCreate && (
        <SearchIssuesDialog
          open={open}
          onOpenChange={setOpen}
          projectId={projectId}
          linkedIssueIds={linkedIssueIds}
          onIssueSelected={(issue) =>
            void handleSelected(issue as unknown as PickedIssue)
          }
        />
      )}
      {open &&
        isCreate &&
        activeIntegration?.integration.provider === "JIRA" && (
          <CreateIssueJiraForm
            open={open}
            onOpenChange={setOpen}
            projectId={projectId}
            integrationId={activeIntegration.integrationId}
            projectIntegrationId={activeIntegration.id}
            failureSignatureId={signatureId}
            defaultValues={defaults}
            onIssueCreated={handleCreated}
          />
        )}
      {open &&
        isCreate &&
        activeIntegration?.integration.provider !== "JIRA" && (
          <CreateIssueDialog
            open={open}
            onOpenChange={setOpen}
            projectId={projectId}
            entityType="failureSignature"
            entityId={signatureId}
            defaultValues={defaults as never}
            onIssueCreated={handleCreated}
          />
        )}
    </>
  );
}
