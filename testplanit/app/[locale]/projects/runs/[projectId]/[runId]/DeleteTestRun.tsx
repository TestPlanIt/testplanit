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

interface DeleteTestRunProps {
  testRun?: TestRuns;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  testRunId: number;
  projectId: number;
  onDelete?: () => void;
}

export function DeleteTestRunModal({
  testRun,
  open,
  onOpenChange,
  testRunId,
  projectId,
  onDelete,
}: DeleteTestRunProps) {
  const router = useRouter();
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
      await updateTestRuns({
        where: {
          id: testRunId,
        },
        data: {
          isDeleted: true,
        },
      });
      // Navigate first to prevent the page from refetching a deleted test run
      router.push(`/projects/runs/${projectId}`);
      toast.success(t("toast.success"));
      if (onDelete) onDelete();
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      toast.error(t("toast.error.title"), {
        description: t("toast.error.description"),
        position: "bottom-right",
      });
      if (onOpenChange) onOpenChange(true);
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
