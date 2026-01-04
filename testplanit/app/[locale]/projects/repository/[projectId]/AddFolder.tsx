"use client";
import { useState, useEffect } from "react";
import {
  useCreateRepositoryFolders,
  useFindFirstRepositoryFolders,
  useFindManyRepositoryFolders,
} from "~/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { CirclePlus, CircleX, Undo2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

const FormSchema = z.object({
  name: z.string().min(2, {
    error: "Please enter a name for the Folder",
  }),
  docs: z.any().optional(),
});

interface AddFolderModalProps {
  projectId: number;
  repositoryId: number;
  parentId: number | null;
  panelWidth: number;
  onFolderCreated?: (newFolderId: number, parentId: number | null) => void;
}

export function AddFolderModal({
  projectId,
  repositoryId,
  parentId,
  panelWidth,
  onFolderCreated,
}: AddFolderModalProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createFolder } = useCreateRepositoryFolders();
  const { data: session } = useSession();
  const [editorKey, setEditorKey] = useState(0);
  // Local state for the effective parent - allows user to override to create root folder
  const [effectiveParentId, setEffectiveParentId] = useState<number | null>(
    parentId
  );

  // Sync effectiveParentId when dialog opens or parentId prop changes
  useEffect(() => {
    if (open) {
      setEffectiveParentId(parentId);
    }
  }, [open, parentId]);

  const { data: parent } = useFindFirstRepositoryFolders(
    {
      where: {
        id: effectiveParentId === null ? undefined : effectiveParentId,
        isDeleted: false,
      },
    },
    {
      enabled: Boolean(effectiveParentId !== null),
    }
  );

  // Query sibling folders to calculate max order for new folder placement
  const { data: siblingFolders } = useFindManyRepositoryFolders(
    {
      where: {
        projectId,
        parentId: effectiveParentId,
        isDeleted: false,
      },
      select: {
        order: true,
      },
    },
    {
      enabled: open, // Only fetch when dialog is open
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

  // Keyboard shortcut: Shift+N to open Add Folder dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Shift+N is pressed and no modal/input is focused
      if (
        e.shiftKey &&
        e.key === "N" &&
        !open &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        // Don't trigger if user is typing in an input, textarea, or contenteditable
        const target = e.target as HTMLElement;
        const isInputElement =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (!isInputElement) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

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
        // Calculate the next order value (max order among siblings + 1)
        const maxOrder =
          siblingFolders?.reduce(
            (max, folder) => Math.max(max, folder.order),
            -1
          ) ?? -1;
        const newOrder = maxOrder + 1;

        const newFolder = await createFolder({
          data: {
            name: data.name,
            docs: data.docs
              ? JSON.stringify(data.docs)
              : JSON.stringify(emptyEditorContent),
            parentId: effectiveParentId,
            projectId,
            repositoryId,
            creatorId: session.user.id!,
            order: newOrder,
          },
        });

        setOpen(false);
        setIsSubmitting(false);
        form.reset();
        setEditorKey((prev) => prev + 1);

        // Trigger refetch to update the tree view and pass new folder info
        if (onFolderCreated && newFolder) {
          onFolderCreated(newFolder.id, effectiveParentId);
        }
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
        <Button
          className="mt-0.5"
          variant="secondary"
          data-testid="add-folder-button"
          title={`${t("repository.addFolder")} (Shift+N)`}
        >
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
              <DialogDescription className="sr-only">
                {t("repository.addFolder")}
              </DialogDescription>
              <div className="text-sm text-muted-foreground">
                <TooltipProvider>
                  {effectiveParentId !== null && parent?.name ? (
                    <div className="flex items-center gap-1">
                      <span>
                        {t("repository.parentFolder")}: {parent.name}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={() => setEffectiveParentId(null)}
                            data-testid="remove-parent-folder-button"
                          >
                            <CircleX className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("repository.removeParentFolder")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span>{t("repository.rootFolder")}</span>
                      {parentId !== null && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => setEffectiveParentId(parentId)}
                            >
                              <Undo2 className="h-4 w-4 text-muted-foreground hover:text-primary" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("repository.createInSelectedFolder")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </TooltipProvider>
              </div>
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
                    <Input
                      placeholder={t("common.placeholders.name")}
                      data-testid="folder-name-input"
                      autoFocus
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
              <Button
                variant="outline"
                type="button"
                onClick={handleCancel}
                data-testid="folder-cancel-button"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="folder-submit-button"
              >
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
