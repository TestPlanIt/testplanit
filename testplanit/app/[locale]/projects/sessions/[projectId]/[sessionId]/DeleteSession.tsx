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

interface DeleteSessionProps {
  testSession?: Sessions;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sessionId: number;
  projectId: number;
}

export function DeleteSessionModal({
  testSession,
  open,
  onOpenChange,
  sessionId,
  projectId,
}: DeleteSessionProps) {
  const router = useRouter();
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
      await updateSessions({
        where: {
          id: sessionId,
        },
        data: {
          isDeleted: true,
        },
      });
      toast.promise(
        new Promise((resolve) => setTimeout(resolve, 2000)), // 2 second delay
        {
          loading: t("sessions.delete.toast.loading"),
          success: () => {
            router.push(`/projects/sessions/${projectId}`);
            return t("sessions.delete.toast.success");
          },
          error: t("sessions.delete.toast.error.title"),
        }
      );
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: t("common.errors.unknown"),
      });
      toast.error(t("sessions.delete.toast.error.title"), {
        description: t("sessions.delete.toast.error.description"),
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
