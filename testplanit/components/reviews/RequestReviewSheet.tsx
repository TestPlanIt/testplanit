"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";

import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { MessageSquareWarning } from "lucide-react";
import { requestReview } from "~/app/actions/reviews";
import {
  commentsQueryKey,
  reviewableEntityTypeToCommentEntityType,
} from "~/components/comments/commentsQueryKey";
import type { IconName } from "~/types/globals";

import { areaForEntityType } from "~/lib/utils/reviewAreas";

import { AssigneeCombobox, type AssigneeOption } from "./AssigneeCombobox";

export type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

export interface ReachableGatedState {
  id: number;
  name: string;
  icon: { name: string };
  color: { value: string };
}

export interface RequestReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ReviewableEntityType;
  entityId: number;
  projectId: number;
  currentStateId: number;
  reachableGatedStates: ReachableGatedState[];
  initialValues?: {
    assignee?: AssigneeOption;
    targetStateId?: number;
  };
}

export function RequestReviewSheet({
  open,
  onOpenChange,
  entityType,
  entityId,
  projectId,
  currentStateId,
  reachableGatedStates,
  initialValues,
}: RequestReviewSheetProps) {
  // Unscoped useTranslations — namespaced ones silently render literal key
  // paths when passed into a Zod schema factory (see
  // [[feedback_namespaced_t_in_zod_schemas]]).
  const t = useTranslations();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const singleReachableStateId =
    reachableGatedStates.length === 1 ? reachableGatedStates[0]!.id : undefined;

  const defaultTargetStateId =
    initialValues?.targetStateId ?? singleReachableStateId ?? 0;

  // Build the Zod schema with full i18n key paths via the unscoped t().
  // `comment` is intentionally optional — common usage is a one-liner
  // ("Please review this.") that the requester shouldn't be forced to type
  // every time. The paired Comment always carries the @mention; prose is
  // additive context, not required for the request to be actionable.
  const formSchema = useMemo(
    () =>
      z.object({
        assigneeKey: z.string().min(1, t("reviews.requester.assigneeRequired")),
        targetStateId: z
          .number()
          .int()
          .min(1, t("reviews.requester.targetStateRequired")),
        comment: z.string().optional(),
      }),
    [t]
  );

  type FormValues = {
    assigneeKey: string;
    targetStateId: number;
    comment?: string;
  };

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(formSchema) as any,
    defaultValues: {
      assigneeKey: initialValues?.assignee
        ? `${initialValues.assignee.kind}:${initialValues.assignee.id}`
        : "",
      targetStateId: defaultTargetStateId,
      comment: "",
    },
  });

  // Track the live assignee object (the Zod schema only validates the
  // selection key; the object carries the kind discriminator the submit
  // payload needs).
  const [selectedAssignee, setSelectedAssignee] =
    useState<AssigneeOption | null>(initialValues?.assignee ?? null);

  // Apply the "Request review again" prefill on the closed → open edge
  // only. `initialValues` is derived from a live ReviewRequest query
  // (ReviewStatusBanner memoizes it off the fetched row), so any background
  // refetch hands this component a value-identical but reference-new object.
  // While the Sheet is open the requester's draft wins: prop churn must not
  // clear the comment box or revert their assignee pick.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      form.reset({
        assigneeKey: initialValues?.assignee
          ? `${initialValues.assignee.kind}:${initialValues.assignee.id}`
          : "",
        targetStateId:
          initialValues?.targetStateId ?? singleReachableStateId ?? 0,
        comment: "",
      });
      setSelectedAssignee(initialValues?.assignee ?? null);
    }
    wasOpenRef.current = open;
    // form / setSelectedAssignee identity is stable enough; depend only on
    // the open edge, the prefill input + the single-reachable shortcut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValues, singleReachableStateId]);

  const handleAssigneeChange = (value: AssigneeOption | null) => {
    setSelectedAssignee(value);
    form.setValue("assigneeKey", value ? `${value.kind}:${value.id}` : "", {
      shouldValidate: true,
    });
  };

  const onSubmit = async (values: FormValues) => {
    if (!selectedAssignee) {
      // Defense-in-depth — the schema requires assigneeKey, but the live
      // selection object is what carries the kind discriminator.
      form.setError("assigneeKey", {
        message: t("reviews.requester.assigneeRequired"),
      });
      return;
    }

    const requestedByUserId = session?.user?.id;
    if (!requestedByUserId) {
      toast.error(t("common.errors.somethingWentWrong"));
      return;
    }

    // WR-03: client-side guard against picking yourself as the direct
    // assignee. The schema `@@validate(assigneeUserId == null ||
    // assigneeUserId != requestedByUserId)` (schema.zmodel) catches this
    // server-side, but ZenStack RPC surfaces validate failures as the
    // generic "Something went wrong" toast with no hint about the actual
    // problem. Pre-checking here renders a localized inline form error so
    // the requester immediately understands why the submit didn't go.
    if (
      selectedAssignee.kind === "user" &&
      selectedAssignee.id === requestedByUserId
    ) {
      form.setError("assigneeKey", {
        message: t("reviews.requester.cannotSelfAssign"),
      });
      return;
    }

    try {
      // Hybrid-comments path (D-21 follow-up): the server action wraps
      // ReviewRequest + paired Comment creation in a transaction and fans
      // out the existing @mention notification for direct user-assignees.
      // The Sheet no longer writes the requester's prose into
      // ReviewRequest.decisionComment — that column is reserved for the
      // reviewer's response and was getting overwritten on decide.
      const result = await requestReview({
        projectId,
        entityType,
        entityId,
        fromStateId: currentStateId,
        toStateId: values.targetStateId,
        assigneeUserId:
          selectedAssignee.kind === "user" ? selectedAssignee.id : null,
        assigneeRoleId:
          selectedAssignee.kind === "role" ? selectedAssignee.id : null,
        commentText: values.comment ?? "",
      });

      if (!result.success) {
        if (result.error === "ALREADY_PENDING") {
          toast.error(t("reviews.requester.alreadyPendingError"));
        } else if (result.error === "INELIGIBLE_ASSIGNEE") {
          toast.error(t("reviews.requester.ineligibleAssigneeError"));
        } else {
          toast.error(t("common.errors.somethingWentWrong"));
        }
        return;
      }

      // Refresh both caches so the entity page reflects the new state
      // without a manual reload:
      //   1. Comments thread → paired REVIEW_REQUEST card lands immediately
      //   2. ReviewRequest queries → the PENDING banner appears (and the
      //      "Request review" trigger auto-hides via the D-02 predicate).
      //      ZenStack-generated hooks key under
      //      `["zenstack", "<Model>", "<operation>", args, ...]` — the model
      //      name is the SECOND element, not the first, so the prefix
      //      `["zenstack", "ReviewRequest"]` is what hits every cached
      //      ReviewRequest query.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: commentsQueryKey(
            reviewableEntityTypeToCommentEntityType(entityType),
            entityId
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: ["zenstack", "ReviewRequest"],
        }),
      ]);

      toast.success(t("reviews.requester.submitSuccess"));
      form.reset({
        assigneeKey: "",
        targetStateId: singleReachableStateId ?? 0,
        comment: "",
      });
      setSelectedAssignee(null);
      onOpenChange(false);
    } catch {
      toast.error(t("common.errors.somethingWentWrong"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col sm:max-w-md"
        data-testid="request-review-sheet"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5" />
            {t("reviews.requester.openButton")}
          </SheetTitle>
          <SheetDescription>
            {t("reviews.requester.sheetDescription")}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              // The Sheet is rendered in a Radix portal, but React's synthetic
              // submit event still bubbles through the React tree to the
              // enclosing case-page form (which has its own `handleSubmit`).
              // react-hook-form's `handleSubmit` calls preventDefault but not
              // stopPropagation, so without this the outer form would also fire
              // its onSubmit when the requester clicks "Request review".
              e.stopPropagation();
              return form.handleSubmit(onSubmit)(e);
            }}
            className="flex flex-1 flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="assigneeKey"
              render={() => (
                <FormItem>
                  <FormLabel>{t("reviews.requester.assigneeLabel")}</FormLabel>
                  <FormControl>
                    <AssigneeCombobox
                      projectId={projectId}
                      value={selectedAssignee}
                      onValueChange={handleAssigneeChange}
                      requireCanApproveOn={areaForEntityType(entityType)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetStateId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("reviews.requester.targetStateLabel")}
                  </FormLabel>
                  <FormControl>
                    <Select
                      value={field.value > 0 ? String(field.value) : ""}
                      onValueChange={(value) => field.onChange(Number(value))}
                    >
                      <SelectTrigger data-testid="request-review-target-state">
                        <SelectValue
                          placeholder={t(
                            "reviews.requester.targetStatePlaceholder"
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {reachableGatedStates.map((state) => (
                          <SelectItem
                            key={state.id}
                            value={String(state.id)}
                            data-testid={`request-review-target-state-option-${state.id}`}
                          >
                            {/* Reachable gated states are gated by
                                definition — set requiresReview so the
                                shared WorkflowStateDisplay shows the
                                warning glyph consistent with other
                                surfaces. */}
                            <WorkflowStateDisplay
                              state={{
                                name: state.name,
                                icon: { name: state.icon.name as IconName },
                                color: { value: state.color.value },
                                requiresReview: true,
                              }}
                              size="sm"
                            />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("reviews.requester.commentLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      data-testid="request-review-comment"
                      placeholder={t("reviews.requester.commentPlaceholder")}
                      rows={4}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="mt-auto flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" data-testid="request-review-submit">
                {t("reviews.requester.openButton")}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
