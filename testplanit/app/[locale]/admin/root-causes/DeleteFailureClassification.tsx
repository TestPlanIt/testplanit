"use client";

import { ClassificationOption } from "@/components/triage/badges";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { schema } from "~/zenstack/schema";
import type { ClassificationRow } from "./types";

interface DeleteFailureClassificationProps {
  classification: ClassificationRow;
  open: boolean;
  onClose: () => void;
}

const CLEAR = "none";

/**
 * Soft-deletes a root cause. Signatures that carry it are moved to the
 * chosen root cause (a merge, recorded as set by the admin) or to none.
 * The AI's own suggestion (a denied-update column) keeps pointing at the
 * deleted row and is hidden by the badges.
 */
export function DeleteFailureClassification({
  classification,
  open,
  onClose,
}: DeleteFailureClassificationProps) {
  const t = useTranslations("admin.rootCauses");
  const tCommon = useTranslations("common");
  const tTriage = useTranslations("triage");
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [targetId, setTargetId] = useState<string>(CLEAR);
  const inUse = classification._count.signatures > 0;

  const queries = useClientQueries(schema);
  const { mutateAsync: update } = queries.failureClassification.useUpdate();
  const { mutateAsync: updateSignatures } =
    queries.failureSignature.useUpdateMany();
  const { data: others } = queries.failureClassification.useFindMany(
    {
      where: { isDeleted: false, id: { not: classification.id } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, name: true, color: { select: { value: true } } },
    },
    { enabled: open && inUse }
  );

  const canConfirm = !isSubmitting;

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      if (inUse) {
        await updateSignatures({
          where: { classificationId: classification.id },
          data:
            targetId !== CLEAR
              ? {
                  classificationId: Number(targetId),
                  classificationSource: "MANUAL",
                  classifiedAt: new Date(),
                  classifiedById: session?.user?.id ?? null,
                }
              : {
                  classificationId: null,
                  classificationSource: null,
                  classifiedAt: null,
                  classifiedById: null,
                },
        });
      }
      await update({
        where: { id: classification.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      onClose();
    } catch (error) {
      console.error("Failed to delete root cause:", error);
      toast.error(tCommon("errors.unknown"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tCommon("actions.delete")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("delete.confirmMessage", { name: classification.name })}
            {inUse &&
              ` ${t("delete.inUse", { count: classification._count.signatures })}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {inUse && (
          <div className="space-y-2">
            <Label htmlFor="root-cause-delete-target">
              {t("delete.moveLabel", {
                count: classification._count.signatures,
              })}
            </Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger
                id="root-cause-delete-target"
                className="w-full"
                data-testid="root-cause-delete-target"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CLEAR}>{tTriage("unclassified")}</SelectItem>
                {(others ?? []).map((other) => (
                  <SelectItem key={other.id} value={String(other.id)}>
                    <ClassificationOption classification={other} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            disabled={!canConfirm}
            data-testid="failure-classification-delete-confirm"
          >
            {tCommon("actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
