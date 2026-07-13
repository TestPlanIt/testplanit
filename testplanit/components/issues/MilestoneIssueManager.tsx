"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Cloud, MoreHorizontal, Plus, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SearchIssuesDialog } from "./search-issues-dialog";

/**
 * Manual link/unlink manager for `MilestoneIssue` rows (MLINK-03, D-09/D-10).
 *
 * Unlike `ManageExternalIssues`/`ManageSimpleUrlIssues` (which write via
 * `/api/integrations/jira/link-issue`, designed for the implicit m2m
 * relations on TestCase/TestRun/Session), `MilestoneIssue` is an explicit
 * join table with a `source` discriminator. This component writes directly
 * through `useClientQueries(schema).milestoneIssue.useCreate()`/`.useDelete()`
 * — the same explicit-join-table idiom `EditGroup.tsx` uses for
 * `groupAssignment` (see `app/[locale]/admin/groups/EditGroup.tsx:107-214`).
 *
 * SYNCED rows are Jira-owned (D-10): the enhanced client is denied
 * create/delete on `source == SYNCED` at the schema layer
 * (`schema.zmodel` MilestoneIssue `@@deny`). This component mirrors that
 * with a client-side skip — SYNCED rows never trigger a delete call, and
 * their row action explains "managed by Jira" instead of unlinking.
 */

interface ExternalIssueSelection {
  isExternal: true;
  id: string;
  key?: string;
  title: string;
  externalId?: string;
  externalKey?: string;
  externalUrl?: string;
  externalStatus?: string;
  status: string;
}

interface InternalIssueSelection {
  isExternal: false;
  id: number;
  name: string;
  title: string;
}

type IssueSelection = ExternalIssueSelection | InternalIssueSelection;

interface MilestoneIssueManagerProps {
  milestoneId: number;
  projectId: number;
  /** The integration backing this project's issue tracker, if any — needed
   * to resolve a search-selected external issue into a local `Issue` row
   * via `issue.useUpsert()` keyed on `externalId_integrationId` (mirrors
   * `ManageSimpleUrlIssues.tsx`'s upsert-then-link pattern). */
  integrationId?: number;
  /** issueIds already linked to this milestone — used to gate "already
   * linked" state in the search dialog. */
  linkedIssueIds: number[];
  onLinked?: () => void;
}

export function MilestoneIssueManager({
  milestoneId,
  projectId,
  integrationId,
  linkedIssueIds,
  onLinked,
}: MilestoneIssueManagerProps) {
  const t = useTranslations("milestones.members");
  const tIssues = useTranslations("issues");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const { mutateAsync: createMilestoneIssue } =
    useClientQueries(schema).milestoneIssue.useCreate();
  const { mutateAsync: upsertIssue } =
    useClientQueries(schema).issue.useUpsert();

  // MLINK-03: manual linking works on ANY milestone, synced or local. A
  // LOCAL milestone has no integrationId of its own, but the search dialog
  // still finds external issues through the PROJECT's active integration —
  // resolve that as the fallback so external selections can be upserted
  // (a project has at most one active integration; see
  // project_single_active_integration).
  const { data: activeProjectIntegration } = useClientQueries(
    schema
  ).projectIntegration.useFindFirst(
    {
      where: { projectId, isActive: true },
      select: { integrationId: true },
    },
    { enabled: integrationId == null }
  );
  const resolvedIntegrationId =
    integrationId ?? activeProjectIntegration?.integrationId;

  const linkExistingIssue = async (issueId: number) => {
    await createMilestoneIssue({
      data: {
        milestoneId,
        issueId,
        source: "MANUAL",
      },
    });
  };

  const handleIssueSelected = async (issue: IssueSelection) => {
    setIsLinking(true);
    try {
      let issueId: number;

      if (issue.isExternal) {
        if (!resolvedIntegrationId) {
          throw new Error("No active integration to resolve external issue");
        }
        const externalId = issue.externalId || issue.key || issue.id;
        const resolved = await upsertIssue({
          where: {
            externalId_integrationId: {
              externalId: String(externalId),
              integrationId: resolvedIntegrationId,
            },
          },
          create: {
            name: issue.key || issue.externalKey || String(externalId),
            title: issue.title,
            externalId: String(externalId),
            externalKey: issue.externalKey || issue.key,
            externalUrl: issue.externalUrl,
            externalStatus: issue.externalStatus || issue.status,
            status: issue.status,
            integration: { connect: { id: resolvedIntegrationId } },
            project: { connect: { id: projectId } },
          } as any,
          update: {
            title: issue.title,
            externalUrl: issue.externalUrl,
            externalStatus: issue.externalStatus || issue.status,
          },
        });
        issueId = resolved.id;
      } else {
        issueId = issue.id;
      }

      await linkExistingIssue(issueId);
      toast.success(t("linkSuccess"));
      setIsSearchOpen(false);
      onLinked?.();
    } catch (err) {
      console.error("Failed to link member issue:", err);
      toast.error(t("linkError"));
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsSearchOpen(true)}
        disabled={isLinking}
        data-testid="member-issues-add-button"
        className="bg-inherit"
      >
        <Plus className="h-4 w-4" />
        {tIssues("linkIssue")}
      </Button>

      {isSearchOpen && (
        <SearchIssuesDialog
          open={isSearchOpen}
          onOpenChange={setIsSearchOpen}
          projectId={projectId}
          linkedIssueIds={linkedIssueIds}
          onIssueSelected={(issue) =>
            void handleIssueSelected(issue as unknown as IssueSelection)
          }
        />
      )}
    </>
  );
}

interface MemberIssueRowActionsProps {
  milestoneId: number;
  issueId: number;
  source: string;
  onUnlinked?: () => void;
  /** Whether the current user may unlink (milestone add/edit). Default true. */
  canUnlink?: boolean;
  /**
   * Whether to show the "Generate test cases" action (the viewer has Test Case
   * Repository add/edit AND the project is connected to an LLM). Default false.
   */
  canGenerate?: boolean;
  /** Opens the seeded Generate Test Cases wizard for this issue. */
  onGenerate?: () => void;
}

/**
 * Per-row unlink action for the Member Issues table (D-09 per-row gesture,
 * not a bulk save form). MANUAL rows get an unlink action; SYNCED rows are
 * locked with a "managed by Jira" explanation — both the client-side skip
 * here and the schema `@@deny('create,delete', source == SYNCED)` enforce
 * the same rule (T-18-07-02).
 */
export function MemberIssueRowActions({
  milestoneId,
  issueId,
  source,
  onUnlinked,
  canUnlink = true,
  canGenerate = false,
  onGenerate,
}: MemberIssueRowActionsProps) {
  const t = useTranslations("milestones.members");
  const tCommon = useTranslations("common");
  const tRepo = useTranslations("repository");
  const { mutateAsync: deleteMilestoneIssue } =
    useClientQueries(schema).milestoneIssue.useDelete();
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isSynced = source === "SYNCED";

  const handleUnlink = async () => {
    if (isSynced) return;
    setIsUnlinking(true);
    try {
      await deleteMilestoneIssue({
        where: { milestoneId_issueId: { milestoneId, issueId } },
      });
      toast.success(t("unlinkSuccess"));
      onUnlinked?.();
    } catch (err) {
      console.error("Failed to unlink member issue:", err);
      toast.error(t("unlinkError"));
    } finally {
      setIsUnlinking(false);
    }
  };

  // Quick "Generate Test Cases for this issue" launcher. Shown for both MANUAL
  // and SYNCED rows — eligibility depends on Test Case Repository access + an
  // LLM connection, not on who owns the issue link.
  const generateButton =
    canGenerate && onGenerate ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={tRepo("generateTestCases.buttonText")}
            data-testid="member-issue-generate-cases"
            onClick={onGenerate}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tRepo("generateTestCases.title")}</TooltipContent>
      </Tooltip>
    ) : null;

  if (isSynced) {
    return (
      <div className="flex items-center justify-end gap-1">
        {generateButton}
        <Badge
          variant="outline"
          className="flex items-center gap-1 text-muted-foreground cursor-default"
          title={t("managedByJira")}
          data-testid="member-issue-synced-lock"
        >
          <Cloud className="h-3 w-3" />
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {generateButton}
      {canUnlink && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={tCommon("actions.actionsLabel")}
              data-testid="member-issue-row-actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={isUnlinking}
              onClick={() => setConfirmOpen(true)}
              data-testid="member-issue-unlink"
            >
              <X className="h-4 w-4" />
              {t("unlink")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("unlinkConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("unlinkConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="member-issue-unlink-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleUnlink()}
              data-testid="member-issue-unlink-confirm"
            >
              {t("unlink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
