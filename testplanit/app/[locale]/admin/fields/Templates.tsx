"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import {
  useFindManyTemplates,
  useDeleteManyTemplateProjectAssignment,
  useCreateManyTemplateProjectAssignment,
  useFindManyProjects,
  useUpdateTemplates,
  useUpdateManyTemplates,
} from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./templateColumns";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AddTemplateModal } from "./AddTemplate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Templates } from "@prisma/client";
import { LayoutTemplate } from "lucide-react";
import { useTranslations } from "next-intl";

export default function TemplateComponent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.templates");
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

  const { mutateAsync: updateTemplate } = useUpdateTemplates();
  const { mutateAsync: updateManyTemplate } = useUpdateManyTemplates();
  const { mutateAsync: createManyTemplateProjectAssignment } =
    useCreateManyTemplateProjectAssignment();
  const { mutateAsync: deleteManyTemplateProjectAssignment } =
    useDeleteManyTemplateProjectAssignment();

  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
  });

  const { data, isLoading } = useFindManyTemplates(
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
        await updateTemplate({
          where: { id },
          data: { isEnabled },
        });
      } catch (error) {
        console.error("Failed to update template:", error);
      }
    },
    [updateTemplate]
  );

  const handleToggleDefault = useCallback((id: number, isDefault: boolean) => {
    setSelectedTemplateId(id);
    setIsAlertDialogOpen(true);
  }, []);

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (selectedTemplateId !== undefined) {
        await updateManyTemplate({
          where: { isDefault: true },
          data: { isDefault: false },
        });
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

  const columns: any[] = useMemo(
    () =>
      getColumns(tCommon, session, handleToggleEnabled, handleToggleDefault),
    [session, handleToggleEnabled, handleToggleDefault, tCommon]
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

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between text-primary">
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <CardTitle>
                  <div className="flex items-center">
                    <LayoutTemplate className="mr-1" />
                    {t("title")}
                  </div>
                </CardTitle>
              </div>
              <div>
                <AddTemplateModal />
              </div>
            </div>
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
              {t("confirmSetAsDefaultWarning")}
              <br />
              {t("confirmSetAsDefaultProjects")}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsAlertDialogOpen(false)}>
                {tCommon("actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleConfirmToggleDefault()}
                className="bg-destructive"
              >
                {tCommon("actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
  return null;
}
