"use client";
import { useState, useEffect } from "react";
import { useUpdateRepositoryCases } from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import { Trash2, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "next-intl";

// Define a more specific type for the testcase prop
interface DeleteModalTestCase {
  id: number;
  name: string;
  testRuns?: Array<{
    testRun: {
      isDeleted: boolean;
      isCompleted: boolean;
      // Add other fields from the 'as' cast if they are strictly necessary for the filter's logic
      // For now, isDeleted and isCompleted are the explicitly used ones in the filter condition.
      id?: number; // Was in the 'as' cast, include if potentially needed
      name?: string; // Was in the 'as' cast
      projectId?: number; // Was in the 'as' cast
      milestone?: { name: string } | null; // Was in the 'as' cast
    };
  }>;
}

interface DeleteCaseProps {
  testcase: DeleteModalTestCase; // Use the new specific type
  showLabel?: boolean;
  onDeleteSuccess?: () => void;
}

export function DeleteCaseModal({
  testcase,
  showLabel,
  onDeleteSuccess,
}: DeleteCaseProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showActiveRunWarning, setShowActiveRunWarning] = useState(false);
  const [activeRunCount, setActiveRunCount] = useState(0);
  const { mutateAsync: updateRepositoryCases } = useUpdateRepositoryCases();

  useEffect(() => {
    if (
      open &&
      testcase &&
      testcase.testRuns &&
      Array.isArray(testcase.testRuns)
    ) {
      const currentActiveRuns = testcase.testRuns.filter((trCase) => {
        const testRun = trCase.testRun as {
          id: number;
          isDeleted: boolean;
          isCompleted: boolean;
          name?: string;
          projectId?: number;
          milestone?: { name: string } | null;
        };
        return testRun && !testRun.isDeleted && !testRun.isCompleted;
      }).length;

      setActiveRunCount(currentActiveRuns);

      if (currentActiveRuns > 0) {
        setShowActiveRunWarning(true);
      } else {
        setShowActiveRunWarning(false);
      }
    } else {
      setShowActiveRunWarning(false);
      setActiveRunCount(0);
    }
  }, [open, testcase]);

  const handleCancel = () => setOpen(false);

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(true);
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      await updateRepositoryCases({
        data: { isDeleted: true },
        where: { id: testcase.id },
      });
      setOpen(false);
      onDeleteSuccess?.();
    } catch (err: any) {
      console.error("Error deleting case:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="secondary"
        className="text-destructive"
        type="button"
        onClick={handleOpen}
      >
        <Trash2 className="h-5 w-5" />
        {showLabel && <div>{t("sharedSteps.confirmDelete")}</div>}
      </Button>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[600px] border-destructive">
        <div className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 mr-2" />
              {t("repository.deleteCase.title")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          {showActiveRunWarning && (
            <div
              className="border border-destructive p-4 rounded-lg bg-destructive/10"
              role="alert"
            >
              <p className="font-bold">
                {t("projects.overview.activeTestRuns")}
              </p>
              <p>
                {t("repository.deleteCase.activeRunWarningMessage", {
                  count: activeRunCount,
                })}
              </p>
            </div>
          )}
          <div className="overflow-hidden">
            {t("repository.deleteCase.confirmMessageStart")}
            <span className="truncate font-bold max-w-[200px] inline-block align-bottom">
              {testcase.name}
            </span>
            {t("repository.deleteCase.confirmMessageEnd")}
          </div>
          <div className="bg-destructive text-destructive-foreground p-2">
            {t("repository.deleteCase.warning")}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={handleCancel}>
              {t("common.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isSubmitting}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {isSubmitting
                ? t("common.status.deleting")
                : t("common.actions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
