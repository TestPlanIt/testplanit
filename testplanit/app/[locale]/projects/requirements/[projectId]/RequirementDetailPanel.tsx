"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import LoadingSpinner from "@/components/LoadingSpinner";
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
import {
  isRequirementLocked,
  LOCKED_ISSUE_FIELDS,
} from "~/lib/services/linkedIssueUpsert";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";
import {
  RequirementProvenanceBadge,
  type RequirementProvenanceBadgeRow,
} from "./RequirementProvenanceBadge";

interface RequirementDetailPanelProps {
  projectId: string;
  requirementId: number;
}

interface RequirementDetailFormData {
  title: string;
  status: string;
  priority: string;
}

/**
 * The editable scalar fields this panel exposes. Deliberately drawn as data
 * (name + label key) rather than one JSX block per field, so the per-field
 * disabled state below reads as a single `LOCKED_ISSUE_FIELDS.includes(name)`
 * membership check instead of a hardcoded per-field condition -- a future
 * field added to that constant only needs a row here, not a new branch.
 * `name` (Issue.name, the tree's own display label) is intentionally absent:
 * it is never locked and renaming is 25-11's surface, not this panel's.
 */
const SCALAR_FIELDS: ReadonlyArray<{
  name: "title" | "status" | "priority";
  labelKey: string;
}> = [
  { name: "title", labelKey: "fields.title" },
  { name: "status", labelKey: "actions.status" },
  { name: "priority", labelKey: "fields.priority" },
];

type RequirementRow = Pick<
  Issue,
  "id" | "name" | "title" | "status" | "priority"
> &
  RequirementProvenanceBadgeRow;

function buildResetValues(row: RequirementRow): RequirementDetailFormData {
  return {
    title: row.title ?? "",
    status: row.status ?? "",
    priority: row.priority ?? "",
  };
}

/**
 * The UI half of PROV-01/02/03: a provenance badge plus lock-aware scalar
 * fields. Task 2 (this same file) adds the HIER-05 Tiptap body bound to
 * `Issue.note`. Attachments (25-12) and linked test cases (25-13) mount
 * into the two placeholder regions at the bottom of this panel.
 */
export default function RequirementDetailPanel({
  projectId,
  requirementId,
}: RequirementDetailPanelProps) {
  const t = useTranslations("requirements.detail");
  const tCommon = useTranslations("common");
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormReady, setIsFormReady] = useState(false);

  const { data: requirement, isLoading } = useClientQueries(
    schema
  ).issue.useFindFirst(
    {
      where: {
        id: requirementId,
        // Spread, never inline -- mirrors RequirementsTreeView.tsx's own
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
    },
  });
  const { isDirty } = form.formState;

  // PROV-03's single editability predicate: every disabled state below --
  // the three scalar fields -- traces back to this one boolean, derived
  // from the same shared service both RequirementProvenanceBadge.tsx and
  // RequirementsTreeView.tsx already use.
  const locked = isRequirementLocked(requirement ?? null);

  useEffect(() => {
    if (requirement && !isFormReady) {
      form.reset(buildResetValues(requirement));
      setIsFormReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement, isFormReady]);

  // A different requirement was selected in the tree -- re-arm the form for
  // the newly selected row (the effect above repopulates it once loaded)
  // and drop out of edit mode rather than carrying over stale edits.
  useEffect(() => {
    setIsFormReady(false);
    setIsEditMode(false);
  }, [requirementId]);

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
      // The three scalar fields are all in LOCKED_ISSUE_FIELDS, so on a
      // locked row they are stripped from the payload client-side too --
      // defense-in-depth alongside the schema's own field-level `@deny`,
      // never a substitute for it (a stale/re-enabled control could still
      // submit a locked field's unchanged value otherwise).
      if (locked) {
        setIsSubmitting(false);
        return;
      }
      const updateData: Record<string, unknown> = {
        title: data.title,
        status: data.status || null,
        priority: data.priority || null,
      };

      await updateRequirement({
        where: { id: requirement.id },
        data: updateData,
      });
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

  return (
    <div
      data-testid="requirement-detail-panel"
      className="flex h-full flex-col gap-4 p-4"
    >
      <div
        data-testid="requirement-detail-header"
        className="flex items-center justify-between gap-2"
      >
        <h2 className="text-lg font-semibold">{requirement.name}</h2>
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
              {tCommon("actions.edit")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="requirement-detail-cancel"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="requirement-detail-save"
                onClick={form.handleSubmit(onSubmit)}
                disabled={isSubmitting || !isDirty}
              >
                {isSubmitting
                  ? tCommon("actions.saving")
                  : tCommon("actions.save")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Form {...form}>
        <form className="flex flex-col gap-4">
          {SCALAR_FIELDS.map(({ name, labelKey }) => {
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
        </form>
      </Form>

      {/* 25-12 mounts the attachments list here. */}
      <div data-testid="requirement-attachments-slot" />
      {/* 25-13 mounts the linked test cases panel here. */}
      <div data-testid="requirement-linked-cases-slot" />
    </div>
  );
}
