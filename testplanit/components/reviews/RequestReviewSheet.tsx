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
import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";

import DynamicIcon from "@/components/DynamicIcon";
import { useCreateReviewRequest } from "~/lib/hooks";
import type { IconName } from "~/types/globals";

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
  const { mutateAsync: createReviewRequest } = useCreateReviewRequest();

  const singleReachableStateId =
    reachableGatedStates.length === 1
      ? reachableGatedStates[0]!.id
      : undefined;

  const defaultTargetStateId =
    initialValues?.targetStateId ?? singleReachableStateId ?? 0;

  // Build the Zod schema with full i18n key paths via the unscoped t().
  const formSchema = useMemo(
    () =>
      z.object({
        assigneeKey: z
          .string()
          .min(1, t("reviews.requester.assigneeRequired")),
        targetStateId: z
          .number()
          .int()
          .min(1, t("reviews.requester.targetStateRequired")),
        comment: z
          .string()
          .min(1, t("reviews.requester.commentRequired")),
      }),
    [t],
  );

  type FormValues = {
    assigneeKey: string;
    targetStateId: number;
    comment: string;
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
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

  // Re-sync defaults when initialValues change (D-08 "Request review again"
  // hits the same Sheet with prefilled state).
  useEffect(() => {
    form.reset({
      assigneeKey: initialValues?.assignee
        ? `${initialValues.assignee.kind}:${initialValues.assignee.id}`
        : "",
      targetStateId: initialValues?.targetStateId ?? singleReachableStateId ?? 0,
      comment: "",
    });
    setSelectedAssignee(initialValues?.assignee ?? null);
    // form / setSelectedAssignee identity is stable enough; depend only on
    // the prefill input + the single-reachable shortcut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues, singleReachableStateId]);

  const handleAssigneeChange = (value: AssigneeOption | null) => {
    setSelectedAssignee(value);
    form.setValue(
      "assigneeKey",
      value ? `${value.kind}:${value.id}` : "",
      { shouldValidate: true },
    );
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
      await createReviewRequest({
        data: {
          projectId,
          entityType,
          entityId,
          fromStateId: currentStateId,
          toStateId: values.targetStateId,
          requestedByUserId,
          assigneeUserId:
            selectedAssignee.kind === "user" ? selectedAssignee.id : null,
          assigneeRoleId:
            selectedAssignee.kind === "role" ? selectedAssignee.id : null,
          decisionComment: values.comment,
          status: "PENDING",
        },
      } as any);

      toast.success(t("reviews.requester.submitSuccess"));
      form.reset({
        assigneeKey: "",
        targetStateId: singleReachableStateId ?? 0,
        comment: "",
      });
      setSelectedAssignee(null);
      onOpenChange(false);
    } catch (err) {
      if (isAlreadyPendingClientError(err)) {
        toast.error(t("reviews.requester.alreadyPendingError"));
      } else {
        toast.error(t("common.errors.somethingWentWrong"));
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col sm:max-w-md"
        data-testid="request-review-sheet"
      >
        <SheetHeader>
          <SheetTitle>{t("reviews.requester.sheetTitle")}</SheetTitle>
          <SheetDescription>
            {t("reviews.requester.sheetDescription")}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="assigneeKey"
              render={() => (
                <FormItem>
                  <FormLabel>
                    {t("reviews.requester.assigneeLabel")}
                  </FormLabel>
                  <FormControl>
                    <AssigneeCombobox
                      projectId={projectId}
                      value={selectedAssignee}
                      onValueChange={handleAssigneeChange}
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
                      onValueChange={(value) =>
                        field.onChange(Number(value))
                      }
                    >
                      <SelectTrigger data-testid="request-review-target-state">
                        <SelectValue
                          placeholder={t(
                            "reviews.requester.targetStatePlaceholder",
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
                            <span className="flex items-center space-x-1">
                              <DynamicIcon
                                name={state.icon.name as IconName}
                                className="h-4 w-4"
                                style={{ color: state.color.value }}
                              />
                              <span className="text-sm">{state.name}</span>
                            </span>
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
                  <FormLabel>
                    {t("reviews.requester.commentLabel")}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      data-testid="request-review-comment"
                      placeholder={t(
                        "reviews.requester.commentPlaceholder",
                      )}
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
                {t("reviews.requester.submitButton")}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Client-side detector for the AlreadyPendingError surface. The ZenStack RPC
 * handler does not preserve the typed error class across the network wire —
 * it serializes the message and surfaces it as `err.info.message` (or the
 * top-level `err.message` in some retry shapes). Treat either shape as a
 * hit. The English "pending review" substring is the load-bearing marker;
 * server error messages stay in English per
 * [[feedback_server_errors_stay_english]] precisely so detectors like this
 * one stay reliable.
 */
function isAlreadyPendingClientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { info?: { message?: string }; message?: string };
  const candidates = [e.info?.message, e.message]
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.toLowerCase());
  return candidates.some(
    (m) =>
      m.includes("pending review") ||
      m.includes("a pending review request already exists"),
  );
}
