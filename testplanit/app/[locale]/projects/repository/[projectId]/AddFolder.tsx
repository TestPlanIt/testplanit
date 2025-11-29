"use client";
import { useState, useEffect } from "react";
import {
  useCreateRepositoryFolders,
  useFindFirstRepositoryFolders,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { CirclePlus } from "lucide-react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

const FormSchema = z.object({
  name: z.string().min(2, {
      error: "Please enter a name for the Folder"
}),
  docs: z.any().optional(),
});

interface AddFolderModalProps {
  projectId: number;
  repositoryId: number;
  parentId: number | null;
  panelWidth: number;
  onFolderCreated?: () => void;
}

export function AddFolderModal({
  projectId,
  repositoryId,
  parentId,
  panelWidth,
  onFolderCreated,
}: AddFolderModalProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createFolder } = useCreateRepositoryFolders();
  const { data: session } = useSession();
  const [editorKey, setEditorKey] = useState(0);

  const { data: parent } = useFindFirstRepositoryFolders(
    {
      where: {
        id: parentId === null ? undefined : parentId,
      },
    },
    {
      enabled: Boolean(parentId !== null),
    }
  );

  const isTextVisible = panelWidth >= 25;

  const handleCancel = () => {
    setOpen(false);
    form.reset();
    setEditorKey((prev) => prev + 1);
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      docs: emptyEditorContent,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: "",
        docs: emptyEditorContent,
      });
      setEditorKey((prev) => prev + 1);
    }
  }, [open, form.reset, form]);

  if (!session?.user?.id) {
    return null;
  }

  const {
    handleSubmit,
    control,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    if (session) {
      try {
        await createFolder({
          data: {
            name: data.name,
            docs: data.docs
              ? JSON.stringify(data.docs)
              : JSON.stringify(emptyEditorContent),
            parentId,
            projectId,
            repositoryId,
            creatorId: session.user.id!,
          },
        });
        setOpen(false);
        setIsSubmitting(false);
        form.reset();
        setEditorKey((prev) => prev + 1);

        // Trigger refetch to update the tree view
        if (onFolderCreated) {
          onFolderCreated();
        }
      } catch (err: any) {
        if (err.info?.prisma && err.info?.code === "P2002") {
          form.setError("name", {
            type: "custom",
            message: t("common.errors.nameExists"),
          });
        } else {
          form.setError("root", {
            type: "custom",
            message: t("common.errors.unknown"),
          });
        }
        setIsSubmitting(false);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          form.reset();
          setEditorKey((prev) => prev + 1);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" data-testid="add-folder-button">
          <CirclePlus className="w-4" />
          <span className={`${isTextVisible ? "inline" : "hidden"}`}>
            {t("repository.addFolder")}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("repository.addFolder")}</DialogTitle>
              <div className="text-sm text-muted-foreground">
                {parent?.name ? (
                  <div>
                    {t("repository.parentFolder")}: {parent.name}
                  </div>
                ) : (
                  <div>{t("repository.rootFolder")}</div>
                )}
              </div>
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
                    <Input
                      placeholder={t("common.placeholders.name")}
                      data-testid="folder-name-input"
                      {...field}
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
                        projectId={projectId.toString()}
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
              <Button variant="outline" type="button" onClick={handleCancel} data-testid="folder-cancel-button">
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="folder-submit-button">
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
