"use client";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { emptyEditorContent } from "~/app/constants";
import {
  useFindFirstRepositoryFolders,
  useUpdateRepositoryFolders,
} from "~/lib/hooks";

const parseTipTapContent = (content: any) => {
  if (!content) return emptyEditorContent;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return emptyEditorContent;
    }
  }
  return content;
};

function buildFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(1, {
      error: t("common.errors.folderNameRequiredEnter"),
    }),
    docs: z.any().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface EditRepositoryFolderModalProps {
  folderId: number;
  open: boolean;
  onClose: () => void;
  projectId?: number;
}

export function EditFolderModal({
  folderId,
  open,
  onClose,
  projectId,
}: EditRepositoryFolderModalProps) {
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateRepositoryFolder } = useUpdateRepositoryFolders();
  const [editorKey, setEditorKey] = useState(0);

  const { data: folder, isLoading: isLoadingFolder } =
    useFindFirstRepositoryFolders({
      where: {
        id: folderId,
        isDeleted: false,
      },
    });

  const handleCancel = () => onClose();

  const defaultFormValues = useMemo(
    () => ({
      name: folder?.name ?? "",
      docs: folder?.docs ? parseTipTapContent(folder.docs) : emptyEditorContent,
    }),
    [folder]
  );

  const formSchema = useMemo(() => buildFormSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open && folder) {
      form.reset({
        name: folder.name ?? "",
        docs: folder.docs
          ? parseTipTapContent(folder.docs)
          : emptyEditorContent,
      });
      setEditorKey((prev) => prev + 1);
    } else if (open) {
      form.reset({
        name: "",
        docs: emptyEditorContent,
      });
      setEditorKey((prev) => prev + 1);
    }
  }, [open, folder, form.reset, form]);

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);
    try {
      await updateRepositoryFolder({
        where: { id: folderId },
        data: {
          name: data.name,
          docs: data.docs
            ? JSON.stringify(data.docs)
            : JSON.stringify(emptyEditorContent),
        },
      });

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      // Check for Prisma unique constraint errors in different possible locations
      // ZenStack may wrap the error differently depending on the context
      const isPrismaError =
        err.info?.prisma ||
        err.code === "P2002" ||
        err.message?.includes("Unique constraint");
      const errorCode = err.info?.code || err.code;

      if (isPrismaError && errorCode === "P2002") {
        form.setError("name", {
          type: "custom",
          message: t("repository.editFolder.errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: t("common.errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  if (isLoadingFolder && open) {
    // Optional: show a loading state inside the dialog if folder data is being fetched
    // return <Dialog open={open} onOpenChange={setOpen}><DialogContent>Loading...</DialogContent></Dialog>;
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("repository.folderActions.edit")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("repository.folderActions.edit")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {t("common.name")}
                    <HelpPopover helpKey="folder.name" />
                  </FormLabel>
                  <FormControl>
                    <input
                      {...field}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="docs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {t("common.fields.documentation")}
                    <HelpPopover helpKey="folder.documentation" />
                  </FormLabel>
                  <FormControl>
                    <div className="w-full border rounded-lg">
                      <TipTapEditor
                        key={editorKey}
                        content={field.value}
                        onUpdate={(newContent) => field.onChange(newContent)}
                        placeholder={t("common.ui.enterDocumentation")}
                        projectId={
                          projectId
                            ? projectId.toString()
                            : `folder-docs-${folderId}`
                        }
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || isLoadingFolder}>
                {isSubmitting
                  ? t("common.actions.submitting")
                  : t("common.actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
