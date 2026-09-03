"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleSlash2,
  Save,
  SquarePen,
  Trash2,
  ClipboardCheck,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { AttachmentChanges } from "@/components/AttachmentsDisplay";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { CoverageChip } from "@/[locale]/projects/milestones/[projectId]/[milestoneId]/CoverageChip";
import { IterationStatusLegendPopover } from "@/components/iterations/IterationStatusLegendPopover";
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
import { Link } from "~/lib/navigation";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import {
  ensureTipTapJSON,
  serializeTipTapJSON,
  tipTapJSONEquals,
} from "~/utils/tiptapConversion";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";
import {
  formatIssueDisplayText,
  hasDistinctIssueTitle,
  resolveRequirementDisplayPriority,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { LinkedRequirementCasesPanel } from "./LinkedRequirementCasesPanel";
import { RequirementAttachments } from "./RequirementAttachments";
import { useRequirementCoverageBreakdown } from "~/hooks/useRequirementCoverage";
import { RequirementCoveragePanel } from "./RequirementCoveragePanel";
import {
  RequirementProvenanceBadge,
  type RequirementProvenanceBadgeRow,
} from "./RequirementProvenanceBadge";
import { RequirementReferencesPanel } from "./RequirementReferencesPanel";
import { RequirementVersionHistory } from "./RequirementVersionHistory";
import type { RequirementExecutionScopeSelection } from "~/utils/requirementExecutionScope";

interface RequirementDetailPanelProps {
  projectId: string;
  requirementId: number;
  /** The workspace's coverage execution scope (milestone/configuration) —
   *  this panel's coverage breakdown and drill-down count under it so the
   *  numbers here always agree with the list beside it. Absent on the
   *  standalone route, which has no scope pickers: unscoped, unchanged. */
  executionScope?: RequirementExecutionScopeSelection;
  /** Opens the list's own Delete Requirement dialog for this requirement,
   *  the same one its row action already offers. This panel
   *  holds no delete logic of its own -- no fetch, no mutation, no
   *  descendant count, no second dialog -- because the dialog needs a
   *  descendant count only the list's in-memory tree holds, and the list's
   *  own `onDeleted` already clears the selection off the server's own
   *  `deletedIds`. Routing through it is what stops the two surfaces from
   *  ever disagreeing about what a delete does. Undefined hides the Delete
   *  affordance entirely (a non-admin viewer, or no row selected yet). */
  onRequestDelete?: () => void;
  /** The workspace's "open this requirement in edit mode" request -- the
   *  row menu's Edit action. The token is monotonically increasing so a new
   *  request for the already-selected row is distinguishable from one this
   *  panel has already consumed (edit, cancel, edit again must work). The
   *  panel enters edit mode only once the named row's form has seeded --
   *  the first-seed branch forces display mode on a selection change, and
   *  this must land after it, never against the previous row's form. */
  editRequest?: { id: number; token: number } | null;
  /** Renders a back arrow inline with the title, pointing here. Supplied
   *  only by the standalone requirement route -- inside the workspace the
   *  tree is already on screen, so there is nothing to go back to. The
   *  route owns the destination rather than this panel composing one,
   *  since only it knows whether the reader should land on the tree with
   *  this requirement selected or somewhere else entirely. */
  backHref?: string;
  /** After "Don't use as requirement" succeeds from this panel's own Synced
   *  badge: the row is no longer a requirement, so the owner must drop the
   *  selection this panel was showing. */
  onExcluded?: (requirementId: number) => void;
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
 * renaming is the list's own in-place rename surface, not this panel's.
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
        {/* `resolveRequirementDisplayStatus` (`utils/issueDisplayText.ts`) --
            the same lock-aware precedence the list column reads through
            (`RequirementsListColumns.tsx`) -- so the two surfaces still
            cannot disagree about which string is authoritative, now on a
            rule that also covers a detached row's own edited status. */}
        <IssueStatusDisplay
          status={resolveRequirementDisplayStatus(row)}
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
        {/* Same lock-aware resolution as the status field above and the
            list's own Priority column. */}
        <IssuePriorityDisplay
          priority={resolveRequirementDisplayPriority(row)}
        />
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
    // `Issue.note` is a `Json?` column that can legally hold a structured
    // document, a JSON-stringified document, a bare string written by an
    // API client, or null; the load path normalises all four to one
    // serialized document exactly once, so every downstream reader -- the
    // editor, the dirty comparison and the save payload -- sees a single
    // shape.
    note: serializeTipTapJSON(row.note),
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
  executionScope,
  onRequestDelete,
  editRequest,
  backHref,
  onExcluded,
}: RequirementDetailPanelProps) {
  const t = useTranslations("requirements.detail");
  const queryClient = useQueryClient();
  const tCommon = useTranslations("common");
  // Scoped separately from `t` (requirements.detail) -- the upload-failure
  // message reuses the attachments section's own existing key rather than
  // adding a new one.
  const tAttachments = useTranslations("requirements.attachments");
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

  // Scoped to this one requirement -- see the hook's own doc for why it does
  // not reuse the list's whole-project rollup.
  const { breakdown: coverageBreakdown, isLoading: coverageIsLoading } =
    useRequirementCoverageBreakdown(
      Number(projectId),
      requirementId,
      executionScope
    );

  const { mutateAsync: updateRequirement } =
    useClientQueries(schema).issue.useUpdate();

  // The attachment mutation hooks live HERE, not in RequirementAttachments.tsx
  // -- that component only stages changes into `AttachmentChanges`; this
  // panel is the sole place anything is written.
  const { data: session } = useSession();
  const { mutateAsync: createAttachment } =
    useClientQueries(schema).attachments.useCreate();
  const { mutateAsync: updateAttachment } =
    useClientQueries(schema).attachments.useUpdate();
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [pendingAttachmentChanges, setPendingAttachmentChanges] =
    useState<AttachmentChanges>({ edits: [], deletes: [] });
  // Bumped on Cancel and after a successful Save to force
  // RequirementAttachments to remount. AttachmentsDisplay's own pending
  // state (pendingEdits/pendingDeletes) resets only when the `attachments`
  // array identity it was handed changes (AttachmentsDisplay.tsx:93-98) --
  // Cancel changes no data, so that array is identical and the child would
  // otherwise keep showing (and re-report) stale staged deletes.
  const [attachmentsResetKey, setAttachmentsResetKey] = useState(0);
  const hasStagedAttachmentChanges =
    stagedFiles.length > 0 ||
    pendingAttachmentChanges.edits.length > 0 ||
    pendingAttachmentChanges.deletes.length > 0;

  const form = useForm<RequirementDetailFormData>({
    defaultValues: {
      title: "",
      status: "",
      priority: "",
      note: JSON.stringify(emptyEditorContent),
    },
  });
  // Both read during render (the react-hook-form subscription trap): a
  // Proxy field is only tracked by `formState` if something reads it while
  // rendering. Reading `dirtyFields` for the first time inside `onSubmit`
  // would give a value nothing subscribed to.
  const { isDirty, dirtyFields } = form.formState;

  // What the form currently mirrors, as a value snapshot rather than the
  // requirement object's own identity -- `optimisticUpdate: true` re-renders
  // this component on every cache touch, most of which hand back a NEW
  // object with the SAME field values. Resetting on every new identity
  // would fight a typing user and could loop; comparing by value makes the
  // re-seed fire only on a genuine external change.
  const lastSeededValuesRef = useRef<string | null>(null);

  // PROV-03's single editability predicate: every disabled state below --
  // the three scalar fields -- traces back to this one boolean, derived
  // from the same shared service both RequirementProvenanceBadge.tsx and
  // RequirementsListView.tsx already use. The rich-text section
  // deliberately never reads it (see the comment beside its own `readOnly`).
  const locked = isRequirementLocked(requirement ?? null);

  // A native requirement has `name === title` by construction -- both
  // creation paths write the same trimmed string (see issueDisplayText.ts's
  // own note), so in DISPLAY mode its Title field would just be the
  // header's own text repeated in a plain box, and it stays hidden there.
  // Edit mode is different: the header is not an input, so the field is
  // the panel's only rename affordance and must render whenever the row is
  // editable. A synced requirement whose tracker summary genuinely differs
  // from its key renders the field in both modes, locked while synced.
  const hasDistinctTitle = Boolean(
    requirement && hasDistinctIssueTitle(requirement)
  );
  const showTitleField = hasDistinctTitle || (isEditMode && !locked);

  useEffect(() => {
    if (!requirement) return;
    const freshValues = buildResetValues(requirement);
    const freshSnapshot = JSON.stringify(freshValues);

    if (!isFormReady) {
      // First seed for this requirementId: reset, record the loaded id,
      // force display mode. Staged attachment work belongs to the
      // requirement it was staged on, so a selection change is an implicit
      // cancel of it -- the same discard `handleCancel` performs. The
      // reset-key bump matters even when the newly selected requirement has
      // no attachments at all: `AttachmentsDisplay` clears its own pending
      // state only when the `attachments` array identity it was handed
      // changes, and that never happens here because the component with
      // zero attachments to show doesn't mount in the first place.
      form.reset(freshValues);
      lastSeededValuesRef.current = freshSnapshot;
      setLoadedRequirementId(requirementId);
      setIsEditMode(false);
      setStagedFiles([]);
      setPendingAttachmentChanges({ edits: [], deletes: [] });
      setAttachmentsResetKey((key) => key + 1);
      return;
    }

    if (freshSnapshot === lastSeededValuesRef.current) return;

    // Re-seed on a genuine external change (a rename landing while this
    // panel sits idle), but ONLY while the user is not holding a
    // pen -- mid-edit (isEditMode) or a dirty, unsaved form must never be
    // reset out from under them. Bailing on EITHER means both conditions
    // must be false before the reset below runs: dirty alone misses a user
    // who has opened Edit but not yet typed; edit-mode alone costs nothing
    // extra to also check.
    if (isEditMode || isDirty) return;

    form.reset(freshValues);
    lastSeededValuesRef.current = freshSnapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement, requirementId, isFormReady, isEditMode, isDirty]);

  const handleCancel = () => {
    setIsEditMode(false);
    if (requirement) {
      form.reset(buildResetValues(requirement));
    }
    // Discard every staged attachment change. The counter bump is
    // necessary, not decorative -- see the comment beside its declaration.
    setStagedFiles([]);
    setPendingAttachmentChanges({ edits: [], deletes: [] });
    setAttachmentsResetKey((key) => key + 1);
  };

  // Re-seeds from the freshest `requirement` at the exact moment the user
  // asks to edit, updating the snapshot ref too. The idle re-seed above can
  // legitimately stay inert for a moment (a stale render, a race with a
  // refetch) -- this closes that window structurally, so "clicking Edit
  // shows the old name" cannot happen rather than merely being unlikely.
  const handleEdit = () => {
    if (requirement) {
      const freshValues = buildResetValues(requirement);
      form.reset(freshValues);
      lastSeededValuesRef.current = JSON.stringify(freshValues);
    }
    setIsEditMode(true);
  };

  // Consume the workspace's editRequest (see the prop's doc comment): at
  // most once per token, and only after the named row's form has seeded, so
  // it can never race the first-seed branch's forced display mode or open
  // edit mode against the previous row's values.
  const consumedEditTokenRef = useRef(0);
  useEffect(() => {
    if (!editRequest) return;
    if (editRequest.token === consumedEditTokenRef.current) return;
    if (!isFormReady || loadedRequirementId !== editRequest.id) return;
    consumedEditTokenRef.current = editRequest.token;
    handleEdit();
    // `handleEdit` is a plain function recreated per render; the token ref
    // above makes this effect idempotent, so it is deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest, isFormReady, loadedRequirementId]);

  const onSubmit = async (data: RequirementDetailFormData) => {
    if (!requirement) return;
    setIsSubmitting(true);
    try {
      // `note` stays editable on locked rows (HIER-05/PROV-01, see the
      // comment beside the editor below) but is only SENT when it actually
      // changed from the loaded value AND react-hook-form itself reports it
      // dirty (belt and braces -- both must agree). A null note loads as the
      // canonical empty doc, so unconditionally sending it rewrote NULL ->
      // empty-doc on the first save of ANY field -- and `note` is a watched
      // column of the contentUpdatedAt trigger, so that phantom write armed
      // the content-change suspect flag on a save that touched only the
      // priority.
      //
      // The three scalars below get the SAME discipline as
      // `note` -- each is only sent when `dirtyFields` reports the user
      // actually touched it. An untouched field and "still holding the
      // value we loaded five minutes ago" are indistinguishable from the
      // form's own point of view, and on a row renamed elsewhere the loaded
      // value is now wrong: sending it unconditionally is exactly the
      // write-back that silently reverted a rename's title half. This is an
      // ADDITIONAL narrowing on top of the `!locked` strip below, never a
      // replacement for it -- the schema's field-level `@deny` remains the
      // real enforcement; the three scalars are still in
      // LOCKED_ISSUE_FIELDS, so a locked row strips them client-side too,
      // defense-in-depth against a stale/re-enabled control.
      const updateData: Record<string, unknown> = {};
      // Structural compare, not string compare: the loaded side is a
      // jsonb round-trip whose key order differs from the editor's
      // serialization of the identical document.
      if (
        dirtyFields.note &&
        !tipTapJSONEquals(data.note, buildResetValues(requirement).note)
      ) {
        updateData.note = ensureTipTapJSON(data.note);
      }
      // A blank title is treated the way the list's in-place rename
      // already treats one -- a silent no-op rather than a write. The
      // silence is deliberate and matches the rename path, so no new
      // message is introduced here. On a row whose name and title are one
      // string (native, or detached without a distinct tracker summary),
      // this field IS the rename affordance, so it writes both columns
      // with the same trimmed value -- exactly what CreateRequirementDialog
      // and the list's rename commit write. A row with a genuinely
      // distinct title keeps its `name` (the tracker key its badge and
      // header cite) untouched.
      if (!locked) {
        if (dirtyFields.title) {
          const trimmedTitle = data.title.trim();
          if (trimmedTitle) {
            updateData.title = trimmedTitle;
            if (!hasDistinctTitle) updateData.name = trimmedTitle;
          }
        }
        if (dirtyFields.status) updateData.status = data.status || null;
        if (dirtyFields.priority) updateData.priority = data.priority || null;
      }

      if (Object.keys(updateData).length > 0) {
        await updateRequirement({
          where: { id: requirement.id },
          data: updateData,
        });
        // Content versions are written by a DB trigger, not by this client,
        // so the auto-invalidation that follows the update never reaches the
        // version-history query; refresh it so the new entry shows at once.
        void queryClient.invalidateQueries({
          queryKey: ["zenstack", "IssueVersions"],
        });
      }

      // Apply staged attachment changes -- edits, then deletes, then
      // uploads -- OUTSIDE the guard above. An attachment-only change
      // legitimately leaves `updateData` empty (correct: nothing on the
      // Issue row changed), so it must never skip this block.
      const editPromises = pendingAttachmentChanges.edits.map((edit) =>
        updateAttachment({
          where: { id: edit.id },
          data: { name: edit.name, note: edit.note },
        })
      );
      const deletePromises = pendingAttachmentChanges.deletes.map(
        (attachmentId) =>
          // Always soft-delete -- never a real delete of user data.
          updateAttachment({
            where: { id: attachmentId },
            data: { isDeleted: true },
          })
      );
      await Promise.all([...editPromises, ...deletePromises]);

      if (stagedFiles.length > 0) {
        const userId = session?.user?.id;
        // `fetchSignedUrl` performs the upload to object storage itself --
        // this guard must run before the FIRST call to it, or an unresolved
        // session still writes a real object under a path ending in
        // `undefined` and only fails afterward, at the row insert.
        if (!userId) {
          console.error(
            "Refusing to upload a requirement attachment without a signed-in user"
          );
          toast.error(tAttachments("uploadFailed"));
          return;
        }

        const results = await Promise.allSettled(
          stagedFiles.map(async (file) => {
            const fileUrl = await fetchSignedUrl(
              file,
              `/api/get-attachment-url/`,
              `${projectId}/${userId}`
            );
            await createAttachment({
              data: {
                issue: { connect: { id: requirement.id } },
                url: fileUrl,
                name: file.name,
                note: "",
                mimeType: file.type,
                size: BigInt(file.size),
                createdBy: { connect: { id: userId } },
              },
            });
          })
        );
        const failed = stagedFiles.filter(
          (_, index) => results[index].status === "rejected"
        );
        if (failed.length > 0) {
          console.error(
            "Failed to upload requirement attachment:",
            (
              results.find(
                (r) => r.status === "rejected"
              ) as PromiseRejectedResult
            ).reason
          );
          // Only the files that actually failed stay staged -- a retry
          // must not re-upload a file that already landed. The edits/deletes
          // block above is idempotent by construction (isDeleted: true, a
          // name/note rewrite to the same values), so it is deliberately
          // re-applied in full on a retry rather than consumed mid-save;
          // only this upload half needs to narrow itself down.
          setStagedFiles(failed);
          toast.error(tAttachments("uploadFailed"));
          return;
        }
      }

      toast.success(t("saveSuccess"));
      setIsEditMode(false);
      setStagedFiles([]);
      setPendingAttachmentChanges({ edits: [], deletes: [] });
      setAttachmentsResetKey((key) => key + 1);
    } catch (error) {
      console.error("Failed to update requirement:", error);
      toast.error(t("saveFailed"));
      // Deliberately no `finally`-driven exit from edit mode and no
      // clearing of staged state here -- a failed save must keep exactly
      // what the user staged.
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
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
    // Checked BEFORE the form-ready gate: the form only ever seeds from a
    // loaded row, so on a settled-null query `isFormReady` never flips and
    // gating on it first would spin forever.
    return null;
  }

  if (!isFormReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner />
      </div>
    );
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
          {/* Standalone-route only, exactly like TestCaseDetailsView's own
              back arrow (which it gates on `!inSheet`): inside the panel
              there is nothing to go "back" to, the tree is right there.
              Rendered HERE rather than by the route so it sits inline with
              the title instead of stranded on a line above it. `asChild`
              renders one anchor carrying the button's styles -- nesting a
              button inside the link would put a target inside a target and
              leave the outer one all but unclickable (2.5.8 Target Size). */}
          {backHref && (
            <Button
              asChild
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={tCommon("aria.backToRequirements")}
              data-testid="requirement-detail-back"
            >
              <Link href={backHref}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          )}
          <IssueTypeIcon
            fallbackIcon={ClipboardCheck}
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
            onExcluded={onExcluded}
          />
          {!isEditMode ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="requirement-detail-edit"
              onClick={handleEdit}
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
                // An attachment-only change leaves the Issue row's
                // own form clean (`isDirty` false) -- `isDirty` alone
                // cannot see a staged file/edit/delete, so Save must also
                // stay enabled when the only change is a staged attachment
                // change, or the whole feature is unreachable.
                disabled={
                  isSubmitting || (!isDirty && !hasStagedAttachmentChanges)
                }
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
              {onRequestDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  data-testid="requirement-detail-delete"
                  onClick={onRequestDelete}
                  disabled={isSubmitting}
                >
                  {renderActionButtonContent(Trash2, tCommon("actions.delete"))}
                </Button>
              )}
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
                      content={ensureTipTapJSON(field.value)}
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
        key={attachmentsResetKey}
        requirementId={requirement.id}
        isEditMode={isEditMode}
        isSaving={isSubmitting}
        onStagedFilesChange={setStagedFiles}
        onPendingChangesChange={setPendingAttachmentChanges}
      />

      {/* The list's own coverage chip, heading the covering-cases card below
          it: the summary answers "is this covered?" and the card answers "by
          what", so the two read as one section. Same component and same
          `uncoveredWhen` the list column renders, so the two surfaces cannot
          disagree about what a state looks like -- and the same legend the
          list's own column header carries, since a reader meeting these
          status colours here needs the key as much as one meeting them
          there. */}
      <div
        className="flex items-center"
        data-testid="requirement-detail-coverage-summary"
      >
        <span className="text-sm font-medium">{t("coverageLabel")}</span>
        <IterationStatusLegendPopover projectId={Number(projectId)} />
        {coverageBreakdown ? (
          <span className="flex-auto pl-2">
            <CoverageChip
              breakdown={coverageBreakdown}
              uncoveredWhen="no-linked-cases"
            />
          </span>
        ) : (
          // Never render an Uncovered chip for a breakdown that simply has
          // not arrived (or failed): "uncovered" is a claim about the data,
          // and this surface must not make it on the strength of a pending
          // request. The list column takes the same position.
          <span className="text-sm text-muted-foreground pl-2">
            {coverageIsLoading ? tCommon("loading") : "—"}
          </span>
        )}
      </div>

      {/* Coverage summary first, then the editable link list -- read-only
          subtree drill-down above, direct-link editor below. See
          RequirementCoveragePanel.tsx's own comment for why the two never
          merge. */}
      <RequirementCoveragePanel
        projectId={projectId}
        requirementId={requirement.id}
        executionScope={executionScope}
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
      {/* Content history last: the audit trail of the text itself, the
          trigger-written IssueVersions rows with per-version diffs. */}
      <RequirementVersionHistory requirementId={requirement.id} />
    </div>
  );
}
