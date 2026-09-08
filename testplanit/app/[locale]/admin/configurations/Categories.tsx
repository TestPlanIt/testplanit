import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { Loading } from "@/components/Loading";
import { CustomColumnMeta } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
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
import { Input } from "@/components/ui/input";
import { PlusCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod/v4";
import { useRouter } from "~/lib/navigation";
import {
  CategoryRow,
  ConfigCategoryWithVariants,
  useColumns,
  VariantRow,
} from "./categoryColumns";
import { DeleteConfigCategory } from "./DeleteCategory";
import { EditCategory } from "./EditCategory";
import { DeleteVariantModal } from "./DeleteVariantModal";
import { EditVariantModal } from "./EditVariantModal";

export type Variant = {
  id?: number;
  name: string;
  isEnabled: boolean;
  categoryId: number;
};

export default function CategoryList() {
  return <ConfigCategoriesList />;
}

function ConfigCategoriesList() {
  const t = useTranslations("admin.configurations.categories");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const { mutateAsync: createConfigCategory } =
    useClientQueries(schema).configCategories.useCreate();
  const { mutateAsync: createConfigVariant } =
    useClientQueries(schema).configVariants.useCreate();
  const { mutateAsync: updateConfigVariant } =
    useClientQueries(schema).configVariants.useUpdate();
  const { mutateAsync: updateManyConfigurations } =
    useClientQueries(schema).configurations.useUpdateMany();

  const inputRef = useRef<HTMLInputElement>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });
  const [isAdding, setIsAdding] = useState(false);
  const [newRecordName, setNewRecordName] = useState("");
  const [addingVariantForCategory, setAddingVariantForCategory] = useState<
    number | null
  >(null);
  const [configCategories, setConfigCategories] = useState<
    ConfigCategoryWithVariants[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [variantToDisable, setVariantToDisable] = useState<number | null>(null);
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [variantToEdit, setVariantToEdit] = useState<Variant | null>(null);
  const [variantToDelete, setVariantToDelete] = useState<Variant | null>(null);
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [expanded, setExpanded] = useState({});

  const ConfigCategorySchema = z.object({
    name: z.string().min(1, {
      message: tCommon("fields.validation.nameRequired"),
    }),
  });
  const ConfigVariantSchema = z.object({
    name: z.string().min(1, {
      message: tCommon("fields.validation.nameRequired"),
    }),
  });

  const { data, refetch, isLoading } = useClientQueries(
    schema
  ).configCategories.useFindMany(
    {
      where: {
        isDeleted: false,
        name: {
          contains: debouncedSearchString,
          mode: "insensitive",
        },
      },
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        variants: {
          where: { isDeleted: false },
          orderBy: { name: "asc" },
        },
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: false,
    }
  );

  useEffect(() => {
    if (data) {
      setConfigCategories(data);
    }
  }, [data]);

  useEffect(() => {
    if (isAdding && inputRef.current) inputRef.current.focus();
  }, [isAdding]);

  useEffect(() => {
    if (status !== "loading" && !session) router.push("/");
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

  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    setSortConfig(
      direction === null
        ? { column: "name", direction: "asc" }
        : { column, direction }
    );
  };

  const handleAddVariantClick = useCallback((categoryId: number) => {
    setAddingVariantForCategory(categoryId);
    setVariantError(null);
  }, []);

  const handleVariantCancel = useCallback(() => {
    setAddingVariantForCategory(null);
    setVariantError(null);
  }, []);

  const handleVariantSubmit = async (categoryId: number, name: string) => {
    try {
      const result = ConfigVariantSchema.safeParse({ name });

      if (!result.success) {
        setVariantError(result.error.issues[0].message);
        return;
      }

      await createConfigVariant({
        data: { name, categoryId, isEnabled: true },
      });

      setAddingVariantForCategory(null);
      setVariantError(null);
      void refetch();
    } catch (error) {
      console.error("Failed to create variant:", error);
      setVariantError(tCommon("errors.unknown"));
    }
  };

  const onSubmit = async () => {
    try {
      const result = ConfigCategorySchema.safeParse({
        name: newRecordName.trim(),
      });

      if (!result.success) {
        setError(result.error.issues[0].message);
        return;
      }

      await createConfigCategory({
        data: {
          name: newRecordName.trim(),
        },
      });

      setIsAdding(false);
      setNewRecordName("");
      setError(null);
      void refetch();
    } catch (error) {
      console.error("Failed to create category:", error);
      setError(tCommon("errors.unknown"));
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewRecordName(e.target.value);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setNewRecordName("");
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void onSubmit();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  const handleToggleVariant = async (variantId: number, isEnabled: boolean) => {
    if (isEnabled) {
      // If currently enabled, trigger confirmation dialog for disabling
      setVariantToDisable(variantId);
      setIsAlertDialogOpen(true);
    } else {
      // If currently disabled, enable it directly
      try {
        setIsSubmitting(true);
        await updateConfigVariant({
          where: { id: variantId },
          data: { isEnabled: true },
        });
        await refetch();
        setIsSubmitting(false);
      } catch (err) {
        setIsSubmitting(false);
        console.error("Failed to enable variant:", err);
        // Optionally set an error state here to inform the user
      }
    }
  };

  const confirmDisableVariant = async () => {
    if (variantToDisable !== null) {
      try {
        setIsSubmitting(true);

        // Disable the variant
        await updateConfigVariant({
          where: { id: variantToDisable },
          data: { isEnabled: false },
        });

        // Disable related configurations (Ensure useClientQueries(schema).configurations.useUpdateMany hook is imported and used)
        await updateManyConfigurations({
          where: {
            variants: {
              some: { variantId: variantToDisable },
            },
          },
          data: { isEnabled: false },
        });

        await refetch();

        setIsAlertDialogOpen(false);
        setIsSubmitting(false);
        setVariantToDisable(null);
      } catch (err) {
        setIsSubmitting(false);
        console.error("Failed to disable variant:", err);
        // Optionally set an error state here to inform the user
        setIsAlertDialogOpen(false); // Close dialog even on error
        setVariantToDisable(null);
      }
    }
  };

  const handleVariantUpdate = (_updatedVariant: Variant) => {
    setVariantToEdit(null);
    void refetch();
  };

  const handleVariantDelete = (_variantId: number) => {
    void refetch();
  };

  const [editingCategory, setEditingCategory] =
    useState<ConfigCategoryWithVariants | null>(null);
  const [deletingCategory, setDeletingCategory] =
    useState<ConfigCategoryWithVariants | null>(null);

  // Stabilize the mutation-backed handlers so the column set (which closes over
  // them) keeps a steady identity — ZenStack's mutateAsync changes identity
  // every render, which would otherwise rebuild the columns on each render.
  const toggleVariantRef = useRef(handleToggleVariant);
  const submitVariantRef = useRef(handleVariantSubmit);
  useEffect(() => {
    toggleVariantRef.current = handleToggleVariant;
    submitVariantRef.current = handleVariantSubmit;
  });

  const onToggleVariant = useCallback(
    (variantId: number, isEnabled: boolean) =>
      toggleVariantRef.current(variantId, isEnabled),
    []
  );
  const onVariantSubmit = useCallback(
    (categoryId: number, name: string) =>
      submitVariantRef.current(categoryId, name),
    []
  );
  const onEditVariant = useCallback(
    (variant: VariantRow) => setVariantToEdit(variant),
    []
  );
  const onDeleteVariant = useCallback(
    (variant: VariantRow) => setVariantToDelete(variant),
    []
  );

  const columns = useColumns(tCommon, {
    onEditCategory: setEditingCategory,
    onDeleteCategory: setDeletingCategory,
    onToggleVariant,
    onEditVariant,
    onDeleteVariant,
    addingVariantForCategory,
    isSubmitting,
    variantError,
    onAddVariantClick: handleAddVariantClick,
    onVariantSubmit,
    onVariantCancel: handleVariantCancel,
  });

  // Adapt the loaded categories into the table's row model: each category is a
  // `category` row whose sub-rows are its `variant` rows plus a trailing `add`
  // affordance (see CategoryRow). `getSubRows` hands those to TanStack so they
  // render as real nested rows that match the parent's columns and height.
  const tableData = useMemo<CategoryRow[]>(
    () =>
      configCategories.map((category) => ({
        ...category,
        rowKind: "category" as const,
      })),
    [configCategories]
  );

  const getSubRows = useCallback(
    (row: CategoryRow): CategoryRow[] | undefined => {
      if (row.rowKind !== "category") return undefined;
      const variantRows: CategoryRow[] = row.variants.map((variant) => ({
        rowKind: "variant" as const,
        id: variant.id!,
        name: variant.name,
        isEnabled: variant.isEnabled,
        categoryId: variant.categoryId,
      }));
      return [
        ...variantRows,
        {
          rowKind: "add" as const,
          id: `add-${row.id}`,
          name: "",
          categoryId: Number(row.id),
        },
      ];
    },
    []
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const columnVisibilityQuery = searchParams.get("columns");
    if (columnVisibilityQuery) {
      const visibleColumns = columnVisibilityQuery.split(",");
      const initialVisibility: Record<string, boolean> = {};
      columns.forEach((column) => {
        initialVisibility[column.id as string] = visibleColumns.includes(
          column.id as string
        );
      });
      return initialVisibility;
    }
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] =
        (column.meta as CustomColumnMeta)?.isVisible ?? true;
    });
    return initialVisibility;
  });

  const renderCategories = () => (
    <div className="flex flex-col gap-4">
      <Filter
        key="category-filter"
        className="max-w-sm min-w-[250px]"
        placeholder={t("filterPlaceholder")}
        initialSearchString={searchString}
        onSearchChange={setSearchString}
      />

      <DataTable
        columns={columns}
        data={tableData}
        getSubRows={getSubRows}
        onSortChange={handleSortChange}
        onSortColumn={handleSortColumn}
        sortConfig={sortConfig}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        isLoading={isLoading}
        expanded={expanded}
        onExpandedChange={setExpanded}
        storageKey="admin-config-categories"
      />
    </div>
  );

  if (status === "loading") return <Loading />;

  return (
    <main>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{t("title")}</CardTitle>
              <HelpPopover helpKey="categories" />
            </SectionHeader>
            <Button
              onClick={() => setIsAdding(true)}
              aria-label={tGlobal("common.fields.placeholders.addCategory")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <PlusCircle className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {tGlobal("common.fields.placeholders.addCategory")}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>{renderCategories()}</CardContent>
      </Card>

      {isAdding && (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  value={newRecordName}
                  onChange={handleNameChange}
                  onKeyDown={handleKeyDown}
                  placeholder={tGlobal(
                    "common.fields.placeholders.addCategory"
                  )}
                  className="max-w-xs"
                />
                <Button onClick={onSubmit} disabled={isSubmitting}>
                  {isSubmitting
                    ? tCommon("actions.submitting")
                    : tCommon("actions.submit")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                >
                  {tCommon("cancel")}
                </Button>
              </div>
              {error && <div className="text-sm text-destructive">{error}</div>}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={isAlertDialogOpen} onOpenChange={setIsAlertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("disable.confirmDisableTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("disable.confirmDisableDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisableVariant}>
              {tCommon("actions.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {variantToEdit && (
        <EditVariantModal
          variant={variantToEdit}
          open={true}
          onClose={() => setVariantToEdit(null)}
          onSave={handleVariantUpdate}
        />
      )}

      {variantToDelete && (
        <DeleteVariantModal
          variant={variantToDelete}
          open={true}
          onClose={() => setVariantToDelete(null)}
          onDelete={handleVariantDelete}
        />
      )}
      {editingCategory && (
        <EditCategory
          category={editingCategory}
          open={true}
          onClose={() => setEditingCategory(null)}
        />
      )}
      {deletingCategory && (
        <DeleteConfigCategory
          category={deletingCategory}
          open={true}
          onClose={() => setDeletingCategory(null)}
        />
      )}
    </main>
  );
}
