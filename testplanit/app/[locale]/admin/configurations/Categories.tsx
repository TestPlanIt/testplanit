import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useFindManyConfigCategories,
  useCreateConfigCategories,
  useCreateConfigVariants,
  useUpdateConfigVariants,
  useUpdateManyConfigurations,
} from "~/lib/hooks";
import { z } from "zod/v4";
import { DataTable } from "@/components/tables/DataTable";
import { ConfigCategoryWithVariants, getColumns } from "./categoryColumns";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusCircle } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EditVariantModal } from "./EditVariantModal";
import { DeleteVariantModal } from "./DeleteVariantModal";
import { useDebounce } from "@/components/Debounce";
import { CustomColumnMeta } from "@/components/tables/ColumnSelection";
import { Loading } from "@/components/Loading";
import { Filter } from "@/components/tables/Filter";

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
  const { mutateAsync: createConfigCategory } = useCreateConfigCategories();
  const { mutateAsync: createConfigVariant } = useCreateConfigVariants();
  const { mutateAsync: updateConfigVariant } = useUpdateConfigVariants();
  const { mutateAsync: updateManyConfigurations } =
    useUpdateManyConfigurations();

  const inputRef = useRef<HTMLInputElement>(null);
  const variantInputRef = useRef<HTMLInputElement>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });
  const [isAdding, setIsAdding] = useState(false);
  const [newRecordName, setNewRecordName] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
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

  const { data, refetch, isLoading } = useFindManyConfigCategories(
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

  const debouncedNewRecordName = useDebounce(newRecordName, 2000);
  const debouncedNewVariantName = useDebounce(newVariantName, 2000);

  useEffect(() => {
    if (data) {
      setConfigCategories(data);
    }
  }, [data]);

  useEffect(() => {
    if (isAdding && inputRef.current) inputRef.current.focus();
  }, [isAdding]);

  useEffect(() => {
    if (addingVariantForCategory !== null && variantInputRef.current)
      variantInputRef.current.focus();
  }, [addingVariantForCategory]);

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

  const handleAddVariantClick = (categoryId: number | string) =>
    setAddingVariantForCategory(Number(categoryId));

  const handleVariantNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewVariantName(e.target.value);
  };

  const handleVariantCancel = () => {
    setAddingVariantForCategory(null);
    setNewVariantName("");
    setVariantError(null);
  };

  const handleVariantSubmit = async (categoryId: number | string) => {
    try {
      const result = ConfigVariantSchema.safeParse({
        name: newVariantName.trim(),
      });

      if (!result.success) {
        setVariantError(result.error.issues[0].message);
        return;
      }

      await createConfigVariant({
        data: {
          name: newVariantName.trim(),
          categoryId: Number(categoryId),
          isEnabled: true,
        },
      });

      setAddingVariantForCategory(null);
      setNewVariantName("");
      setVariantError(null);
      refetch();
    } catch (error) {
      console.error("Failed to create variant:", error);
      setVariantError(tCommon("errors.unknown"));
    }
  };

  const handleVariantKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    categoryId: number | string
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleVariantSubmit(categoryId);
    } else if (e.key === "Escape") {
      handleVariantCancel();
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
      refetch();
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
      onSubmit();
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

        // Disable related configurations (Ensure useUpdateManyConfigurations hook is imported and used)
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

  const handleVariantUpdate = (updatedVariant: Variant) => {
    setVariantToEdit(null);
    refetch();
  };

  const handleVariantDelete = (variantId: number) => {
    refetch();
  };

  const columns = useMemo(() => getColumns(tCommon), [tCommon]);

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

  const renderExpandedRow = (row: ConfigCategoryWithVariants) => (
    <div className="p-4 bg-muted/50">
      {/* Display existing variants */}
      <ul className="list-outside ml-4 space-y-2 mb-4">
        {row.variants.map((variant) => (
          <li
            key={variant.id}
            className="flex items-center justify-between p-1 rounded-md hover:bg-background"
          >
            <div className="flex items-center">
              <Switch
                checked={variant.isEnabled}
                onCheckedChange={() =>
                  handleToggleVariant(variant.id!, variant.isEnabled)
                }
                id={`checkbox-${variant.id}`}
                className="mr-2 w-8 h-4"
              />
              <Label
                htmlFor={`checkbox-${variant.id}`}
                className={`cursor-pointer text-sm font-medium leading-none ${
                  !variant.isEnabled ? "text-muted-foreground" : ""
                }`}
              >
                {variant.name}
              </Label>
            </div>
            <div className="flex items-center gap-1">
              <EditVariantModal
                variant={variant}
                onClose={() => setVariantToEdit(null)}
                onSave={handleVariantUpdate}
              />
              <DeleteVariantModal
                variant={variant}
                onClose={() => setVariantToDelete(null)}
                onDelete={handleVariantDelete}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Add new variant section (conditional) */}
      <div className="ml-4">
        {addingVariantForCategory === row.id ? (
          <div className="flex items-center gap-2 mt-2">
            <Input
              ref={variantInputRef}
              value={newVariantName}
              onChange={handleVariantNameChange}
              onKeyDown={(e) => handleVariantKeyDown(e, row.id)}
              placeholder={tCommon("fields.placeholders.addVariant")}
              className="max-w-xs"
            />
            <Button
              onClick={() => handleVariantSubmit(row.id)}
              disabled={isSubmitting || !newVariantName.trim()}
              size="sm"
            >
              {tCommon("actions.save")}
            </Button>
            <Button
              variant="outline"
              onClick={handleVariantCancel}
              disabled={isSubmitting}
              size="sm"
            >
              {tCommon("cancel")}
            </Button>
            {variantError && (
              <div className="text-sm text-destructive mt-1">
                {variantError}
              </div>
            )}
          </div>
        ) : (
          <Button
            variant="link"
            onClick={(e) => {
              e.stopPropagation(); // Prevent row collapse
              handleAddVariantClick(row.id);
            }}
            className="flex items-center p-0 h-auto text-sm"
          >
            <PlusCircle className="w-4 h-4 mr-1" />
            {`${tCommon("actions.add")} Variant`}
          </Button>
        )}
      </div>
    </div>
  );

  const renderCategories = () => (
    <div className="flex flex-col gap-4 w-fit">
      <div className="flex flex-row items-start">
        <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
          <div className="text-muted-foreground w-full text-nowrap">
            <Filter
              key="category-filter"
              placeholder={t("filterPlaceholder")}
              initialSearchString={searchString}
              onSearchChange={setSearchString}
            />
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={configCategories}
        onSortChange={handleSortChange}
        sortConfig={sortConfig}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        isLoading={isLoading}
        expanded={expanded}
        onExpandedChange={setExpanded}
        renderExpandedRow={renderExpandedRow}
      />
    </div>
  );

  if (status === "loading") return <Loading />;

  return (
    <main>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between text-primary">
            <CardTitle className="text-xl md:text-2xl">{t("title")}</CardTitle>
            <Button onClick={() => setIsAdding(true)}>
              <PlusCircle className="w-4" />
              <span className="hidden md:inline">{tGlobal("common.fields.placeholders.addCategory")}</span>
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
                  placeholder={tGlobal("common.fields.placeholders.addCategory")}
                  className="max-w-xs"
                />
                <Button onClick={onSubmit} disabled={isSubmitting}>
                  {isSubmitting
                    ? tCommon("status.submitting")
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
          onClose={() => setVariantToEdit(null)}
          onSave={handleVariantUpdate}
        />
      )}

      {variantToDelete && (
        <DeleteVariantModal
          variant={variantToDelete}
          onClose={() => setVariantToDelete(null)}
          onDelete={handleVariantDelete}
        />
      )}
    </main>
  );
}
