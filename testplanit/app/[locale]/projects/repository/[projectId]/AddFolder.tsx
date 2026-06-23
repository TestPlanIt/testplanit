"use client";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { CircleX, Undo2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { emptyEditorContent } from "~/app/constants";

function buildFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(2, {
      error: t("common.errors.folderNameRequired"),
    }),
    docs: z.any().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface AddFolderProps {
  projectId: number;
  repositoryId: number;
  parentId: number | null;
  open: boolean;
  onClose: () => void;
  onFolderCreated?: (newFolderId: number, parentId: number | null) => void;
}

export function AddFolder({
  projectId,
  repositoryId,
  parentId,
  open,
  onClose,
  onFolderCreated,
}: AddFolderProps) {
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createFolder } = useClientQueries(schema).repositoryFolders.useCreate();
  const { data: session } = useSession();
  // Local state for the effective parent - allows user to override to create root folder.
  // Initialized from prop; reset on each open via React unmount.
  const [effectiveParentId, setEffectiveParentId] = useState<number | null>(
    parentId
  );

  const { data: parent } = useClientQueries(schema).repositoryFolders.useFindFirst(
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
  const { data: siblingFolders } = useClientQueries(schema).repositoryFolders.useFindMany({
    where: {
      projectId,
      parentId: effectiveParentId,
      isDeleted: false,
    },
    select: {
      order: true,
    },
  });

  const formSchema = useMemo(() => buildFormSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      name: "",
      docs: emptyEditorContent,
    },
  });

  if (!session?.user?.id) {
    return null;
  }

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: FormValues) {
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

        onClose();
        setIsSubmitting(false);

        // Trigger refetch to update the tree view and pass new folder info
        if (onFolderCreated && newFolder) {
          onFolderCreated(newFolder.id, effectiveParentId);
        }
      } catch (err: any) {
        // Detect unique constraint violations across Prisma and ZenStack error formats
        const errorMsg = err.info?.message || err.message || "";
        const isUniqueViolation =
          err.code === "P2002" ||
          err.info?.code === "P2002" ||
          err.info?.prisma ||
          errorMsg.includes("Unique constraint") ||
          errorMsg.includes("unique constraint") ||
          errorMsg.includes("duplicate key");

        if (isUniqueViolation) {
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
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("repository.addFolder")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("repository.addFolder")}
              </DialogDescription>
              <div className="text-sm text-muted-foreground">
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
                          aria-label={t("repository.removeParentFolder")}
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
                onClick={onClose}
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
