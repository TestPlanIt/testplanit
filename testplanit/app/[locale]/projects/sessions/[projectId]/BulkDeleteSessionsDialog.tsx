"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { toast } from "sonner";

interface BulkDeleteSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionIds: number[];
  onDone: () => void;
}

const BulkDeleteSessionsDialog: React.FC<BulkDeleteSessionsDialogProps> = ({
  open,
  onOpenChange,
  sessionIds,
  onDone,
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: updateSession } =
    useClientQueries(schema).sessions.useUpdate();

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        sessionIds.map((id) =>
          updateSession({ where: { id }, data: { isDeleted: true } })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(
          t("common.bulk.partialFailure", {
            failedCount: failed,
            totalCount: sessionIds.length,
          })
        );
      } else {
        toast.success(
          t("common.bulk.deleteSuccess", { count: sessionIds.length })
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "Sessions"],
      });
      onOpenChange(false);
      onDone();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("sessions.bulk.deleteTitle", { count: sessionIds.length })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("sessions.bulk.deleteDescription", { count: sessionIds.length })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-start space-x-2 text-destructive-foreground bg-destructive p-2">
          <TriangleAlert className="w-6 h-6 shrink-0" />
          <p>{t("sessions.delete.warning")}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isSubmitting}
            data-testid="bulk-delete-sessions-confirm"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default BulkDeleteSessionsDialog;
