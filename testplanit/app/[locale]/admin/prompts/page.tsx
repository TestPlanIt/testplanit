"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import { toast } from "sonner";
import { AddPromptConfig } from "./AddPromptConfig";
import { ExtendedPromptConfig, useColumns } from "./columns";
import { DeletePromptConfig } from "./DeletePromptConfig";
import { EditPromptConfig } from "./EditPromptConfig";

export default function PromptsAdminPage() {
  return <PromptConfigList />;
}

function PromptConfigList() {
  const locale = useLocale();
  const t = useTranslations("admin.prompts");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { mutateAsync: updatePromptConfig } =
    useClientQueries(schema).promptConfig.useUpdate();

  const updatePromptConfigRef = useRef(updatePromptConfig);
  useEffect(() => {
    updatePromptConfigRef.current = updatePromptConfig;
  });

  // Single full-set fetch feeds the virtualized table directly; the table
  // renders only the visible window so there's no page seam and no need for a
  // separate count query (the loaded array length IS the total).
  const {
    data: configs,
    isLoading,
    refetch,
  } = useClientQueries(schema).promptConfig.useFindMany(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        prompts: {
          include: {
            llmIntegration: {
              select: { id: true, name: true },
            },
          },
        },
        projects: true,
      },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive" as const,
            },
          },
          { isDeleted: false },
        ],
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  const handleToggleDefault = useCallback(
    async (id: string, currentIsDefault: boolean) => {
      if (currentIsDefault) return; // Can't un-default the current default

      try {
        // The single-default DB trigger (tpl_single_default_promptconfig)
        // clears the previous default atomically.

        // Set new default (force active)
        await updatePromptConfigRef.current({
          where: { id },
          data: { isDefault: true, isActive: true },
        });

        toast.success(t("defaultChanged"));
      } catch (error) {
        console.error("Failed to update default:", error);
        toast.error(tGlobal("common.errors.error"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configs]
  );

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const [editingConfig, setEditingConfig] =
    useState<ExtendedPromptConfig | null>(null);
  const [deletingConfig, setDeletingConfig] =
    useState<ExtendedPromptConfig | null>(null);

  const columns = useColumns(
    userPreferences,

    handleToggleDefault,
    tCommon,
    t,
    setEditingConfig,
    setDeletingConfig
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (status === "loading") return null;

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="prompts-admin-page-title">
                {t("title")}
              </CardTitle>
              <HelpPopover helpKey="prompts" />
            </SectionHeader>
            <Button
              onClick={() => setShowAddDialog(true)}
              aria-label={t("addPromptConfig")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {t("addPromptConfig")}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="prompts-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="prompts-column-selection"
                      storageKey="admin-prompts"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                </div>
              </div>
            </div>

            {(configs?.length ?? 0) > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: (configs?.length ?? 0).toLocaleString(locale),
                  total: (configs?.length ?? 0).toLocaleString(locale),
                })}
              </p>
            )}
          </div>

          <div className="mt-4 w-full">
            <DataTable
              virtualized
              fillViewport
              columns={columns as any}
              data={(configs as ExtendedPromptConfig[]) || []}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-prompts-table"
              rowTestIdPrefix="admin-prompt-row"
            />
          </div>
        </CardContent>
      </Card>

      {showAddDialog && (
        <AddPromptConfig
          open={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          onSuccess={() => {
            setShowAddDialog(false);
            void refetch();
          }}
        />
      )}
      {editingConfig && (
        <EditPromptConfig
          config={editingConfig}
          open={true}
          onClose={() => setEditingConfig(null)}
        />
      )}
      {deletingConfig && (
        <DeletePromptConfig
          config={deletingConfig}
          open={true}
          onClose={() => setDeletingConfig(null)}
        />
      )}
    </main>
  );
}
