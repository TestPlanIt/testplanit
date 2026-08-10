"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DataTable } from "@/components/tables/DataTable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import type { Templates } from "~/zenstack/models";
import { CirclePlus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { AddTemplate } from "./AddTemplate";
import { DeleteTemplate } from "./DeleteTemplate";
import { EditTemplate } from "./EditTemplate";
import { ExtendedTemplates, useColumns } from "./templateColumns";

export default function TemplateComponent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.templates");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [sortConfig, setSortConfig] = useState<
    | {
        column: string;
        direction: "asc" | "desc";
      }
    | undefined
  >({
    column: "templateName",
    direction: "asc",
  });
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<
    number | undefined
  >(undefined);
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<ExtendedTemplates | null>(null);
  const [deletingTemplate, setDeletingTemplate] =
    useState<ExtendedTemplates | null>(null);

  const { mutateAsync: updateTemplate } =
    useClientQueries(schema).templates.useUpdate();
  const { mutateAsync: createManyTemplateProjectAssignment } =
    useClientQueries(schema).templateProjectAssignment.useCreateMany();
  const { mutateAsync: deleteManyTemplateProjectAssignment } =
    useClientQueries(schema).templateProjectAssignment.useDeleteMany();

  // Stabilize mutation refs — ZenStack's mutateAsync changes identity every render,
  // which would cause useCallback/useMemo to recompute and remount table cells.
  const updateTemplateRef = useRef(updateTemplate);
  useEffect(() => {
    updateTemplateRef.current = updateTemplate;
  });

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
  });

  const { data, isLoading } = useClientQueries(schema).templates.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { templateName: "asc" },
      include: {
        caseFields: true,
        resultFields: true,
        projects: true,
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );
  const templates = data as Templates[];

  const handleToggleEnabled = useCallback(
    async (id: number, isEnabled: boolean) => {
      try {
        await updateTemplateRef.current({
          where: { id },
          data: { isEnabled },
        });
      } catch (error) {
        console.error("Failed to update template:", error);
      }
    },
    []
  );

  const handleToggleDefault = useCallback((id: number, _isDefault: boolean) => {
    setSelectedTemplateId(id);
    setIsAlertDialogOpen(true);
  }, []);

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (selectedTemplateId !== undefined) {
        // The single-default DB trigger (tpl_single_default_templates) clears
        // the previous default atomically.
        await updateTemplate({
          where: { id: selectedTemplateId },
          data: { isDefault: true, isEnabled: true },
        });

        await deleteManyTemplateProjectAssignment({
          where: { templateId: selectedTemplateId },
        });

        if (Array.isArray(projects)) {
          await createManyTemplateProjectAssignment({
            data: projects.map((project) => ({
              projectId: project.id,
              templateId: selectedTemplateId,
            })),
          });
        }
      }
    } catch (error) {
      console.error("Failed to update template:", error);
    }
  };

  const columns: any[] = useColumns(
    tCommon,
    handleToggleEnabled,
    handleToggleDefault,
    setEditingTemplate,
    setDeletingTemplate
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] = column.meta?.isVisible ?? true;
    });
    return initialVisibility;
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig(undefined);
    } else {
      setSortConfig({ column, direction });
    }
  };

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <>
        <Card data-testid="templates-section">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <SectionHeader className="flex items-center gap-2">
                <CardTitle>{tGlobal("common.labels.templates")}</CardTitle>
                <HelpPopover helpKey="templates" />
              </SectionHeader>
              <Button
                data-testid="add-template-button"
                onClick={() => setAddTemplateOpen(true)}
                aria-label={t("add.title")}
                className="group gap-0 transition-all duration-200 hover:gap-2"
              >
                <CirclePlus className="h-4 w-4" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                  {t("add.title")}
                </span>
              </Button>
            </div>
            {addTemplateOpen && (
              <AddTemplate
                open={addTemplateOpen}
                onClose={() => setAddTemplateOpen(false)}
              />
            )}
          </CardHeader>
          <CardContent>
            <div className="flex justify-between">
              <DataTable
                columns={columns}
                data={templates as any}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoading}
                storageKey="admin-templates"
                onSortColumn={handleSortColumn}
              />
            </div>
          </CardContent>
        </Card>
        <AlertDialog
          open={isAlertDialogOpen}
          onOpenChange={setIsAlertDialogOpen}
        >
          <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                {t("confirmSetAsDefault")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            {t("confirmSetAsDefaultDescription")}
            <AlertDialogDescription>
              {tGlobal("runs.delete.warning")}
              <br />
              {t("confirmSetAsDefaultProjects")}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsAlertDialogOpen(false)}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleConfirmToggleDefault()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {tCommon("actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {editingTemplate && (
          <EditTemplate
            template={editingTemplate as any}
            open={true}
            onClose={() => setEditingTemplate(null)}
          />
        )}
        {deletingTemplate && (
          <DeleteTemplate
            template={deletingTemplate}
            open={true}
            onClose={() => setDeletingTemplate(null)}
          />
        )}
      </>
    );
  }
  return null;
}
