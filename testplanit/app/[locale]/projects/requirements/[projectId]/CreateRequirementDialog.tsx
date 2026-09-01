"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DeferredIssueManager } from "@/components/issues/DeferredIssueManager";
import { RequirementOverrideConfirmDialog } from "@/components/requirements/RequirementOverrideConfirmDialog";
import {
  RequirementReferenceSearchDialog,
  type IssueItem,
} from "@/components/issues/requirement-reference-search-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface CreateRequirementDialogProps {
  projectId: string;
  parentId: number | null;
  /** Display-only — the parent's name for the read-only "Parent" row. The
   *  create payload only ever needs `parentId`; this is purely presentational
   *  so the dialog never has to look the parent back up itself. */
  parentName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires with the id of the row that now exists as a requirement — the
   *  freshly created native one, or the synced issue just promoted. */
  onCreated?: (id: number) => void;
}

type CreateMode = "create" | "promote";

// Promotion targets are always existing rows: the picker's promotableOnly
// mode pins the internal source, and only an internal pick carries the
// numeric Issue id the override route addresses.
type PromotableIssue = Extract<IssueItem, { isExternal: false }>;

/**
 * HIER-02's native create surface, plus the discoverable home for per-issue
 * promotion. Two tabs:
 *
 * - **New requirement** — forked from `create-issue-dialog.tsx`'s
 *   no-tracker branch (`25-PATTERNS.md`'s <interfaces> block, lines 71-95);
 *   the only additions to that verbatim payload shape are `isRequirement:
 *   true` and, for a child create, a `parent: { connect: { id } }`. Never
 *   sets a tracker-link field — a natively created requirement has no
 *   tracker link at all, which is what makes it PROV-03's native state.
 * - **Promote an existing issue** — picks one of this project's synced,
 *   non-requirement issues (the picker's `promotableOnly` mode) and pins
 *   it FORCE_ON through the override route. Nothing is created: the row
 *   already exists, and its hierarchy stays the tracker's, so the parent
 *   the tree opened this dialog with is deliberately NOT applied here.
 *
 * The parent comes from the tree's own selection (the node whose "Add
 * child" action opened this dialog, or `null` from the toolbar's "Add
 * root"), never from a picker.
 */
export function CreateRequirementDialog({
  projectId,
  parentId,
  parentName,
  open,
  onOpenChange,
  onCreated,
}: CreateRequirementDialogProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [mode, setMode] = useState<CreateMode>("create");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // LINK-03/D-16: references picked via DeferredIssueManager while creating
  // this requirement. Only numeric Issue ids -- an external pick has
  // already been upserted to a real Issue row by the time it reaches this
  // component's onIssuesChange, same as every other DeferredIssueManager
  // consumer.
  const [referencedIssueIds, setReferencedIssueIds] = useState<number[]>([]);
  const [promoteTarget, setPromoteTarget] = useState<PromotableIssue | null>(
    null
  );
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [promoteConfirmOpen, setPromoteConfirmOpen] = useState(false);
  const createIssue = useClientQueries(schema).issue.useCreate();

  // Start every open blank and on the create tab — this dialog is reused
  // across every "Add root" / "Add child" invocation rather than being
  // remounted per target, so a stale name, reference pick, or promotion
  // target from a previous open must never survive.
  useEffect(() => {
    if (open) {
      setMode("create");
      setName("");
      setReferencedIssueIds([]);
      setPromoteTarget(null);
    }
  }, [open]);

  const trimmedName = name.trim();
  // Single source of truth for "Return/click would submit" -- the hint below
  // renders from this exact expression, so it can never promise Return works
  // while the button itself stays disabled.
  const canSubmit =
    mode === "create"
      ? Boolean(trimmedName) && !isSubmitting
      : promoteTarget != null && !isSubmitting;

  const handleSubmit = async () => {
    if (!trimmedName || !session?.user?.id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const createData: any = {
        name: trimmedName,
        title: trimmedName,
        description: "",
        status: "open",
        priority: "medium",
        project: { connect: { id: Number(projectId) } },
        createdBy: { connect: { id: session.user.id } },
        isRequirement: true,
      };
      if (parentId != null) {
        createData.parent = { connect: { id: parentId } };
      }
      const created = await createIssue.mutateAsync({ data: createData });
      toast.success(t("requirements.create.success"));

      // Post-create batch attach (D-16): a requirement has no id until
      // submit, so references picked in the dialog can only be attached now.
      // Uniformly send `{ internalIssueId }` for every id -- DeferredIssueManager
      // only ever reports numeric Issue ids through onIssuesChange, and an
      // external pick has already been upserted to a real Issue row by the
      // time it lands in referencedIssueIds, so there is no `external`
      // payload left to reconstruct here (27-07's internal branch verifies
      // the row and creates the join). Independently wrapped: a failed
      // attach must never cost the user the requirement they just created.
      if (created?.id && referencedIssueIds.length > 0) {
        try {
          const responses = await Promise.all(
            referencedIssueIds.map((referencedIssueId) =>
              fetch(
                `/api/projects/${projectId}/requirements/${created.id}/references`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ internalIssueId: referencedIssueId }),
                }
              )
            )
          );
          if (!responses.every((res) => res.ok)) {
            toast.error(t("requirements.references.attachFailed"));
          }
        } catch {
          toast.error(t("requirements.references.attachFailed"));
        }
      }

      onOpenChange(false);
      if (created?.id) {
        onCreated?.(created.id);
      }
    } catch (error) {
      console.error("Failed to create requirement:", error);
      toast.error(t("requirements.create.failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteTarget || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${promoteTarget.id}/override`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ override: "FORCE_ON" }),
        }
      );
      if (!res.ok) {
        throw new Error(`Promote failed with status ${res.status}`);
      }
      toast.success(t("requirements.create.promoteSuccess"));
      onOpenChange(false);
      onCreated?.(promoteTarget.id);
    } catch (error) {
      console.error("Failed to promote issue to requirement:", error);
      toast.error(t("requirements.create.promoteFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Promotion is a conversion, so it goes through the shared confirmation
  // first; the native create submits directly.
  const submit =
    mode === "create"
      ? handleSubmit
      : async () => {
          if (promoteTarget) setPromoteConfirmOpen(true);
        };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-requirement-dialog">
        <DialogHeader>
          <DialogTitle>{t("requirements.create.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("requirements.create.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as CreateMode)}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger
              value="create"
              data-testid="create-requirement-mode-create"
            >
              {t("requirements.create.modeCreate")}
            </TabsTrigger>
            <TabsTrigger
              value="promote"
              data-testid="create-requirement-mode-promote"
            >
              {t("requirements.create.modePromote")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="space-y-3">
            <div className="space-y-1">
              <Label>{t("requirements.create.parentLabel")}</Label>
              <div
                className="text-sm text-muted-foreground"
                data-testid="create-requirement-parent"
              >
                {parentId != null
                  ? (parentName ?? "")
                  : t("requirements.create.parentNone")}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="create-requirement-name">
                {t("requirements.create.nameLabel")}
              </Label>
              <Input
                id="create-requirement-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && trimmedName) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={t("requirements.create.namePlaceholder")}
                autoFocus
                data-testid="create-requirement-name-input"
              />
            </div>
            <div
              className="space-y-1"
              data-testid="create-requirement-references"
            >
              <DeferredIssueManager
                projectId={Number(projectId)}
                selectedIssues={[]}
                linkedIssueIds={referencedIssueIds}
                onIssuesChange={setReferencedIssueIds}
                label={t("requirements.references.createDialogLabel")}
                triggerLabel={t("issues.linkIssue")}
              />
            </div>
          </TabsContent>
          <TabsContent value="promote" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("requirements.create.promoteDescription")}
            </p>
            <div className="space-y-1">
              <Label>{t("requirements.create.parentLabel")}</Label>
              <div
                className="text-sm text-muted-foreground"
                data-testid="create-requirement-promote-parent"
              >
                {t("requirements.create.promoteParentNote")}
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("requirements.create.promoteIssueLabel")}</Label>
              <div className="flex items-center gap-2">
                <div
                  className="min-w-0 flex-1 truncate text-sm"
                  data-testid="create-requirement-promote-target"
                >
                  {promoteTarget ? (
                    <>
                      <span className="font-medium">
                        {promoteTarget.externalKey ?? promoteTarget.name}
                      </span>
                      {promoteTarget.title ? `: ${promoteTarget.title}` : ""}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("requirements.create.promoteNoneSelected")}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPickerOpen(true)}
                  data-testid="create-requirement-promote-pick"
                >
                  {promoteTarget
                    ? t("requirements.create.promoteChangeIssue")
                    : t("requirements.create.promoteChooseIssue")}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            title={
              mode === "create" && canSubmit
                ? t("requirements.create.submitHint")
                : undefined
            }
            data-testid="create-requirement-submit"
          >
            {mode === "create"
              ? t("requirements.create.submit")
              : t("requirements.create.promoteSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
      {promoteTarget && (
        <RequirementOverrideConfirmDialog
          action="promote"
          issueLabel={promoteTarget.externalKey ?? promoteTarget.name}
          open={promoteConfirmOpen}
          onOpenChange={setPromoteConfirmOpen}
          isPending={isSubmitting}
          onConfirm={() => {
            setPromoteConfirmOpen(false);
            void handlePromote();
          }}
        />
      )}
      {/* Mounted only on the promote tab: the picker runs its own
          integration + issue queries the moment it mounts, which the
          default create flow never needs. */}
      {mode === "promote" && (
        <RequirementReferenceSearchDialog
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          projectId={Number(projectId)}
          promotableOnly
          onIssueSelected={(issue) => {
            // promotableOnly pins the internal source, so every pick is an
            // existing row; an external pick has no local id to promote.
            if (!issue.isExternal) {
              setPromoteTarget(issue);
            }
          }}
        />
      )}
    </Dialog>
  );
}
