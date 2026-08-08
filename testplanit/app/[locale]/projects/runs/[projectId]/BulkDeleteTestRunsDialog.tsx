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

interface BulkDeleteTestRunsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testRunIds: number[];
  onDone: () => void;
}

const BulkDeleteTestRunsDialog: React.FC<BulkDeleteTestRunsDialogProps> = ({
  open,
  onOpenChange,
  testRunIds,
  onDone,
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: updateTestRun } =
    useClientQueries(schema).testRuns.useUpdate();

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        testRunIds.map((id) =>
          updateTestRun({ where: { id }, data: { isDeleted: true } })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(
          t("common.bulk.partialFailure", {
            failedCount: failed,
            totalCount: testRunIds.length,
          })
        );
      } else {
        toast.success(
          t("common.bulk.deleteSuccess", { count: testRunIds.length })
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRuns"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["batchTestRunSummaries"],
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
            {t("runs.bulk.deleteTitle", { count: testRunIds.length })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("runs.bulk.deleteDescription", { count: testRunIds.length })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-start space-x-2 text-destructive-foreground bg-destructive p-2">
          <TriangleAlert className="w-6 h-6 shrink-0" />
          <p>{t("runs.delete.warning")}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isSubmitting}
            data-testid="bulk-delete-runs-confirm"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default BulkDeleteTestRunsDialog;
