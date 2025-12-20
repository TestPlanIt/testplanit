"use client";
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateRepositoryFolders,
  useFindFirstRepositoryFolders,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { SquarePen } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

const parseTipTapContent = (content: any) => {
  if (!content) return emptyEditorContent;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch (e) {
      return emptyEditorContent;
    }
  }
  return content;
};

const FormSchema = z.object({
  name: z.string().min(1, {
      error: "Enter a name for the Folder."
}),
  docs: z.any().optional(),
});

interface EditRepositoryFolderModalProps {
  folderId: number;
  selected: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  projectId?: number;
}

export function EditFolderModal({
  folderId,
  selected,
  open: controlledOpen,
  onOpenChange,
  projectId,
}: EditRepositoryFolderModalProps) {
  const t = useTranslations();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen = onOpenChange || setUncontrolledOpen;
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

  const handleCancel = () => setOpen(false);

  const defaultFormValues = useMemo(
    () => ({
      name: folder?.name ?? "",
      docs: folder?.docs ? parseTipTapContent(folder.docs) : emptyEditorContent,
    }),
    [folder]
  );

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
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
    watch,
    setValue,
    handleSubmit,
    control,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      await updateRepositoryFolder({
        where: { id: folder?.id },
        data: {
          name: data.name,
          docs: data.docs
            ? JSON.stringify(data.docs)
            : JSON.stringify(emptyEditorContent),
        },
      });

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
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
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button variant="link" className={`p-1 text-primary-background`}>
            <SquarePen className="h-3 w-3" />
          </Button>
        </DialogTrigger>
      )}
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
                    {t("common.fields.name")}
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
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.status.submitting")
                  : t("common.actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
