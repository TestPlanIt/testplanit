"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { CircleSlash2, Save, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import LoadingSpinner from "@/components/LoadingSpinner";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { emptyEditorContent } from "~/app/constants";
import {
  isRequirementLocked,
  LOCKED_ISSUE_FIELDS,
} from "~/lib/services/linkedIssueUpsert";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";
import {
  formatIssueDisplayText,
  hasDistinctIssueTitle,
} from "~/utils/issueDisplayText";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { LinkedRequirementCasesPanel } from "./LinkedRequirementCasesPanel";
import { RequirementAttachments } from "./RequirementAttachments";
import { RequirementCoveragePanel } from "./RequirementCoveragePanel";
import {
  RequirementProvenanceBadge,
  type RequirementProvenanceBadgeRow,
} from "./RequirementProvenanceBadge";
import { RequirementReferencesPanel } from "./RequirementReferencesPanel";

interface RequirementDetailPanelProps {
  projectId: string;
  requirementId: number;
}

interface RequirementDetailFormData {
  title: string;
  status: string;
  priority: string;
  /** JSON-stringified Tiptap doc, mirroring Milestones.docs' own form shape. */
  note: string;
}

/**
 * The editable scalar fields this panel exposes. Deliberately drawn as data
 * (name + label key + display renderer) rather than one JSX block per field,
 * so the per-field disabled state below reads as a single
 * `LOCKED_ISSUE_FIELDS.includes(name)` membership check instead of a
 * hardcoded per-field condition -- a future field added to that constant
 * only needs a row here, not a new branch. `name` (Issue.name, the tree's
 * own display label) is intentionally absent: it is never locked and
 * renaming is 25-11's surface, not this panel's.
 *
 * `renderDisplay` is what display mode shows in place of the (always
 * disabled-looking) `Input` -- the same badges the list columns render for
 * status/priority (`RequirementsListColumns.tsx`), so the two surfaces can
 * never disagree about how a value looks.
 */
const SCALAR_FIELDS: ReadonlyArray<{
  name: "title" | "status" | "priority";
  labelKey: string;
  renderDisplay: (row: RequirementRow) => React.ReactNode;
}> = [
  {
    name: "title",
    labelKey: "fields.title",
    renderDisplay: (row) => (
      <div data-testid="requirement-display-title" className="text-sm">
        {row.title}
      </div>
    ),
  },
  {
    name: "status",
    labelKey: "actions.status",
    renderDisplay: (row) => (
      <div data-testid="requirement-display-status">
        {/* Same `externalStatus ?? status` fallback as the list column
            (`RequirementsListColumns.tsx`) -- the two surfaces cannot
            disagree about which string is authoritative on a synced row. */}
        <IssueStatusDisplay
          status={row.externalStatus ?? row.status ?? null}
          className="capitalize"
        />
      </div>
    ),
  },
  {
    name: "priority",
    labelKey: "fields.priority",
    renderDisplay: (row) => (
      <div data-testid="requirement-display-priority">
        <IssuePriorityDisplay priority={row.priority} />
      </div>
    ),
  },
];

type RequirementRow = Pick<
  Issue,
  | "id"
  | "name"
  | "title"
  | "status"
  | "priority"
  | "note"
  | "externalStatus"
  | "issueTypeName"
> &
  RequirementProvenanceBadgeRow;

function buildResetValues(row: RequirementRow): RequirementDetailFormData {
  return {
    title: row.title ?? "",
    status: row.status ?? "",
    priority: row.priority ?? "",
    // Legacy-string-vs-JSON parse guard, forked verbatim from
    // Milestones.docs (app/[locale]/projects/milestones/[projectId]/[milestoneId]/page.tsx,
    // its own initial-load reset): a `note` already stored as a JSON string
    // is kept as-is, an object is re-stringified, and a null note becomes
    // the canonical empty doc. Both original shapes round-trip through the
    // same `JSON.parse` on render below, so a legacy string note and a
    // structured JSON note render identically.
    note:
      typeof row.note === "string"
        ? row.note
        : row.note
          ? JSON.stringify(row.note)
          : JSON.stringify(emptyEditorContent),
  };
}

/**
 * HIER-05's authoring surface plus the UI half of PROV-01/02/03: a
 * provenance badge, lock-aware scalar fields, and a Tiptap body bound to
 * `Issue.note` -- which stays editable even on a synced, locked requirement
 * (see the comment beside the editor's `readOnly` below). HIER-06's
 * discrete attachment list (RequirementAttachments) and LINK-01/02's linked
 * test cases (LinkedRequirementCasesPanel) are both mounted below.
 */
export default function RequirementDetailPanel({
  projectId,
  requirementId,
}: RequirementDetailPanelProps) {
  const t = useTranslations("requirements.detail");
  const tCommon = useTranslations("common");
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The id the form was last populated from -- tracking the id itself
  // (rather than a plain "ready" boolean plus a separate "requirementId
  // changed" effect) means one effect both re-arms the form on selection
  // change AND populates it once the new row's data arrives, with no
  // effect-ordering race between the two concerns.
  const [loadedRequirementId, setLoadedRequirementId] = useState<number | null>(
    null
  );
  const isFormReady = loadedRequirementId === requirementId;

  const { data: requirement, isLoading } = useClientQueries(
    schema
  ).issue.useFindFirst(
    {
      where: {
        id: requirementId,
        // Spread, never inline -- mirrors RequirementsListView.tsx's own
        // read and issueRoleScope.ts's own containment-gate contract.
        ...REQUIREMENT_SCOPE_WHERE,
      },
    },
    { optimisticUpdate: true }
  );

  const { mutateAsync: updateRequirement } =
    useClientQueries(schema).issue.useUpdate();

  const form = useForm<RequirementDetailFormData>({
    defaultValues: {
      title: "",
      status: "",
      priority: "",
      note: JSON.stringify(emptyEditorContent),
    },
  });
  const { isDirty } = form.formState;

  // PROV-03's single editability predicate: every disabled state below --
  // the three scalar fields -- traces back to this one boolean, derived
  // from the same shared service both RequirementProvenanceBadge.tsx and
  // RequirementsListView.tsx already use. The rich-text section
  // deliberately never reads it (see the comment beside its own `readOnly`).
  const locked = isRequirementLocked(requirement ?? null);

  // A native requirement has `name === title` by construction -- both
  // creation paths write the same trimmed string (see issueDisplayText.ts's
  // own note), so its Title field would just be the header's own text
  // repeated in a disabled box. A synced requirement whose tracker summary
  // genuinely differs from its key still renders the field, locked. This
  // gates the rendered set only -- `title` is still written on create and
  // rename for parity; nothing about what the row STORES changes here.
  const showTitleField = Boolean(
    requirement && hasDistinctIssueTitle(requirement)
  );

  useEffect(() => {
    if (requirement && !isFormReady) {
      form.reset(buildResetValues(requirement));
      setLoadedRequirementId(requirementId);
      setIsEditMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement, requirementId, isFormReady]);

  const handleCancel = () => {
    setIsEditMode(false);
    if (requirement) {
      form.reset(buildResetValues(requirement));
    }
  };

  const onSubmit = async (data: RequirementDetailFormData) => {
    if (!requirement) return;
    setIsSubmitting(true);
    try {
      // `note` stays editable on locked rows (HIER-05/PROV-01, see the
      // comment beside the editor below) but is only SENT when it actually
      // changed from the loaded value. A null note loads as the canonical
      // empty doc, so unconditionally sending it rewrote NULL -> empty-doc
      // on the first save of ANY field -- and `note` is a watched column of
      // the contentUpdatedAt trigger, so that phantom write armed the
      // suspect flag on a priority-only save (COV-05 D-02, UAT Scenario 2).
      // The three scalar fields ARE in LOCKED_ISSUE_FIELDS, so on a locked
      // row they are stripped from the payload client-side too --
      // defense-in-depth alongside the schema's own field-level `@deny`,
      // never a substitute for it (a stale/re-enabled control could still
      // submit a locked field's unchanged value otherwise).
      const updateData: Record<string, unknown> = {};
      if (data.note !== buildResetValues(requirement).note) {
        updateData.note = JSON.parse(data.note);
      }
      if (!locked) {
        updateData.title = data.title;
        updateData.status = data.status || null;
        updateData.priority = data.priority || null;
      }

      if (Object.keys(updateData).length > 0) {
        await updateRequirement({
          where: { id: requirement.id },
          data: updateData,
        });
      }
      toast.success(t("saveSuccess"));
      setIsEditMode(false);
    } catch (error) {
      console.error("Failed to update requirement:", error);
      toast.error(t("saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !isFormReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!requirement) {
    // The tree only ever selects a live requirement id (REQUIREMENT_SCOPE_WHERE-
    // scoped), so this is unreachable in normal use -- render nothing rather
    // than invent copy for a state the product surface doesn't expose.
    return null;
  }

  // The repository-case details view's own edit/cancel/save idiom
  // (TestCaseDetailsView.tsx's non-compact shape) -- icon + label, `me-2` on
  // the icon, never a `gap-*` class on the Button itself.
  const renderActionButtonContent = (
    Icon: React.ComponentType<{ className?: string }>,
    label: string
  ) => (
    <div className="flex items-center">
      <Icon className="w-5 h-5 me-2" />
      <div>{label}</div>
    </div>
  );

  return (
    <div
      data-testid="requirement-detail-panel"
      className="flex h-full flex-col gap-4 p-4"
    >
      <div
        data-testid="requirement-detail-header"
        className="flex items-center justify-between gap-2"
      >
        {/* Same "KEY: Title" convention as the tree and every other
            issue-backed surface — the bare tracker key says nothing about
            what the requirement is. `min-w-0` + `truncate` on the heading
            (and `flex-auto`, never `flex-1` -- this repo's recorded trap:
            `flex-1`'s zero basis disables every sibling's shrink weight) so
            a long tracker summary shrinks instead of pushing the badge and
            the action buttons off the panel. */}
        <div className="flex min-w-0 items-center gap-2">
          <IssueTypeIcon
            issueTypeName={requirement.issueTypeName}
            iconUrl={requirement.issueTypeIconUrl}
            className="h-4 w-4 shrink-0"
          />
          <h2 className="min-w-0 flex-auto truncate text-lg font-semibold">
            {formatIssueDisplayText(requirement)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <RequirementProvenanceBadge
            requirement={requirement}
            projectId={Number(projectId)}
          />
          {!isEditMode ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="requirement-detail-edit"
              onClick={() => setIsEditMode(true)}
            >
              {renderActionButtonContent(SquarePen, tCommon("actions.edit"))}
            </Button>
          ) : (
            <>
              {/* Save precedes Cancel -- the repository-case details view's
                  own order (TestCaseDetailsView.tsx). */}
              <Button
                type="button"
                variant="default"
                size="sm"
                data-testid="requirement-detail-save"
                onClick={form.handleSubmit(onSubmit)}
                disabled={isSubmitting || !isDirty}
              >
                {renderActionButtonContent(
                  Save,
                  isSubmitting
                    ? tCommon("actions.saving")
                    : tCommon("actions.save")
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="requirement-detail-cancel"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {renderActionButtonContent(CircleSlash2, tCommon("cancel"))}
              </Button>
            </>
          )}
        </div>
      </div>

      <Form {...form}>
        <form className="flex flex-col gap-4">
          {SCALAR_FIELDS.filter(
            ({ name }) => name !== "title" || showTitleField
          ).map(({ name, labelKey, renderDisplay }) => {
            const isLockedField =
              locked &&
              (LOCKED_ISSUE_FIELDS as readonly string[]).includes(name);
            const disabled = !isEditMode || isSubmitting || isLockedField;
            const showLockedHint = isEditMode && isLockedField;

            return (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => {
                  // Display mode never reads `field` -- the badges/plain
                  // text below render straight off the loaded `requirement`,
                  // the same source the list columns read.
                  if (!isEditMode) {
                    return (
                      <FormItem>
                        <FormLabel>{tCommon(labelKey)}</FormLabel>
                        {renderDisplay(requirement)}
                      </FormItem>
                    );
                  }

                  const input = (
                    <FormControl>
                      <Input
                        {...field}
                        disabled={disabled}
                        data-testid={`requirement-field-${name}`}
                      />
                    </FormControl>
                  );
                  return (
                    <FormItem>
                      <FormLabel>{tCommon(labelKey)}</FormLabel>
                      {showLockedHint ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{input}</TooltipTrigger>
                          <TooltipContent>{t("lockedHint")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        input
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            );
          })}

          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("documentation")}</FormLabel>
                {isEditMode || !isTiptapEmpty(requirement.note) ? (
                  <FormControl>
                    <TipTapEditor
                      key={`editing-note-${isEditMode}`}
                      content={
                        field.value
                          ? JSON.parse(field.value)
                          : emptyEditorContent
                      }
                      onUpdate={(newContent) => {
                        if (isEditMode) {
                          field.onChange(JSON.stringify(newContent));
                        }
                      }}
                      // Deliberately NOT `locked` -- `Issue.note` is `Json?`,
                      // is excluded from LOCKED_ISSUE_FIELDS, and plays the
                      // `Milestones.docs` role (Phase 20-02 decision P1c:
                      // "note stays unlocked ... plays Milestones.docs role
                      // not Milestones.note role"). A synced, locked
                      // requirement's rich text stays editable by design --
                      // gating this on `locked` would reintroduce the exact
                      // lock this field was deliberately carved out of.
                      readOnly={!isEditMode}
                      className="h-auto"
                      placeholder={t("documentationPlaceholder")}
                      projectId={projectId}
                    />
                  </FormControl>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    {t("documentationEmpty")}
                  </div>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>

      <RequirementAttachments
        projectId={projectId}
        requirementId={requirement.id}
      />
      {/* Coverage summary first, then the editable link list -- read-only
          subtree drill-down above, direct-link editor below. See
          RequirementCoveragePanel.tsx's own comment for why the two never
          merge. */}
      <RequirementCoveragePanel
        projectId={projectId}
        requirementId={requirement.id}
      />
      <LinkedRequirementCasesPanel
        projectId={projectId}
        requirementId={requirement.id}
      />
      {/* LINK-03's References card, last in the stack (D-13) -- deliberately
          NOT gated on `locked`; see RequirementReferencesPanel.tsx's own
          header comment for why (D-11). */}
      <RequirementReferencesPanel
        projectId={projectId}
        requirementId={requirement.id}
      />
    </div>
  );
}
