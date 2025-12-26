"use client";
import { useState } from "react";
import { useUpdateProjects } from "~/lib/hooks";
import { Projects } from "@prisma/client";
import { useTranslations } from "next-intl";

import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Trash2, TriangleAlert } from "lucide-react";

import { Form } from "@/components/ui/form";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeleteProjectModalProps {
  project: Projects;
}

export function DeleteProjectModal({ project }: DeleteProjectModalProps) {
  const t = useTranslations("admin.projects.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateProjects } = useUpdateProjects();

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateProjects({
        where: { id: project.id },
        data: { isDeleted: true },
      });
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" className="text-destructive">
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div>
              {t.rich("confirmMessage", {
                name: project.name,
                strong: (chunks: any) => (
                  <span className="whitespace-nowrap font-bold">{chunks}</span>
                ),
              })}
            </div>
            <div className="bg-destructive text-destructive-foreground p-2">
              {tGlobal("runs.delete.warning")}
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
              <AlertDialogCancel disabled={isSubmitting}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isSubmitting}
                onClick={onSubmit}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("actions.deleting")
                  : tCommon("actions.confirmDelete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
