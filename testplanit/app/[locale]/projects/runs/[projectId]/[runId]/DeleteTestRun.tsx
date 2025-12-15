"use client";
import { useUpdateTestRuns } from "~/lib/hooks";
import { TestRuns } from "@prisma/client";
import { useForm } from "react-hook-form";
import { TriangleAlert } from "lucide-react";
import { Form } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

interface DeleteTestRunProps {
  testRun?: TestRuns;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  testRunId: number;
  projectId: number;
  onDelete?: () => void;
  onBeforeDelete?: () => void;
}

export function DeleteTestRunModal({
  testRun,
  open,
  onOpenChange,
  testRunId,
  projectId,
  onDelete,
  onBeforeDelete,
}: DeleteTestRunProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mutateAsync: updateTestRuns } = useUpdateTestRuns();
  const t = useTranslations("runs.delete");
  const tCommon = useTranslations("common");

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  const handleCancel = () => {
    if (onOpenChange) onOpenChange(false);
  };

  async function onSubmit() {
    try {
      // Signal that we're about to delete - prevents 404 redirect race condition
      if (onBeforeDelete) onBeforeDelete();

      // Close the dialog immediately to prevent UI flicker
      if (onOpenChange) onOpenChange(false);

      // Remove all queries related to this test run from the cache BEFORE the mutation
      // This prevents the automatic refetch from updating the component with isDeleted: true
      // which would trigger the 404 redirect before navigation completes
      queryClient.removeQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          // Remove queries that include this specific test run ID
          return JSON.stringify(queryKey).includes(`"id":${testRunId}`) ||
                 JSON.stringify(queryKey).includes(`"id": ${testRunId}`);
        },
      });

      // Navigate BEFORE the mutation to avoid any race condition
      // Use replace to prevent going back to the deleted test run page
      router.replace(`/projects/runs/${projectId}`);

      // Show toast
      toast.success(t("toast.success"));

      // Now perform the actual delete mutation
      await updateTestRuns({
        where: {
          id: testRunId,
        },
        data: {
          isDeleted: true,
        },
      });

      // Invalidate the test runs list to refresh the summary page
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return JSON.stringify(queryKey).includes("testRuns") ||
                 JSON.stringify(queryKey).includes("TestRuns");
        },
      });
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      toast.error(t("toast.error.title"), {
        description: t("toast.error.description"),
        position: "bottom-right",
      });
      // Navigate back to the test run page on error since delete failed
      router.replace(`/projects/runs/${projectId}/${testRunId}`);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[600px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="overflow-hidden">{t("description")}</div>
            <div className="bg-destructive text-destructive-foreground p-2">
              {t("warning")}
            </div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <AlertDialogCancel type="button" onClick={handleCancel}>
                {tCommon("actions.cancel")}
              </AlertDialogCancel>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10 px-4 py-2"
              >
                {tCommon("actions.delete")}
              </button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
