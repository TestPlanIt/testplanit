"use client";
import { useUpdateSessions } from "~/lib/hooks";
import { Sessions } from "@prisma/client";
import { useForm } from "react-hook-form";
import { TriangleAlert } from "lucide-react";
import { Form } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
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

interface DeleteSessionProps {
  testSession?: Sessions;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sessionId: number;
  projectId: number;
  onBeforeDelete?: () => void;
}

export function DeleteSessionModal({
  testSession,
  open,
  onOpenChange,
  sessionId,
  projectId,
  onBeforeDelete,
}: DeleteSessionProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mutateAsync: updateSessions } = useUpdateSessions();
  const t = useTranslations();

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  const handleCancel = () => {
    if (onOpenChange) onOpenChange(false);
  };

  async function onSubmit() {
    try {
      // Signal that we're about to delete - prevents race condition
      if (onBeforeDelete) onBeforeDelete();

      // Close the dialog immediately to prevent UI flicker
      if (onOpenChange) onOpenChange(false);

      // Remove all queries related to this session from the cache BEFORE the mutation
      // This prevents the automatic refetch from updating the component with isDeleted: true
      queryClient.removeQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          // Remove queries that include this specific session ID
          return JSON.stringify(queryKey).includes(`"id":${sessionId}`) ||
                 JSON.stringify(queryKey).includes(`"id": ${sessionId}`);
        },
      });

      // Navigate BEFORE the mutation to avoid any race condition
      // Use replace to prevent going back to the deleted session page
      router.replace(`/projects/sessions/${projectId}`);

      // Show toast
      toast.success(t("sessions.delete.toast.success"));

      // Now perform the actual delete mutation
      await updateSessions({
        where: {
          id: sessionId,
        },
        data: {
          isDeleted: true,
        },
      });

      // Invalidate the sessions list to refresh the summary page
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return JSON.stringify(queryKey).includes("sessions") ||
                 JSON.stringify(queryKey).includes("Sessions");
        },
      });
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: t("common.errors.unknown"),
      });
      toast.error(t("sessions.delete.toast.error.title"), {
        description: t("sessions.delete.toast.error.description"),
        position: "bottom-right",
      });
      // Navigate back to the session page on error since delete failed
      router.replace(`/projects/sessions/${projectId}/${sessionId}`);
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
                {t("sessions.delete.title")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="overflow-hidden">
              {t("sessions.delete.confirmMessage", {
                name: testSession?.name ?? "",
              })}
            </div>
            <div className="bg-destructive text-destructive-foreground p-2">
              {t("sessions.delete.warning")}
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
                {t("common.actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                className="bg-destructive text-destructive-foreground"
                onClick={form.handleSubmit(onSubmit)}
              >
                {t("common.actions.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
