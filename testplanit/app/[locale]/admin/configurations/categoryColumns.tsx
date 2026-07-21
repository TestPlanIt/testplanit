import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { ConfigCategories } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import {
  CircleCheckBig,
  CircleSlash2,
  Component,
  PlusCircle,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

export type ConfigCategoryWithVariants = ConfigCategories & {
  variants: {
    id?: number;
    name: string;
    isEnabled: boolean;
    categoryId: number;
  }[];
};

/** A variant rendered as a nested row under its category. */
export interface VariantRow {
  id: number;
  name: string;
  isEnabled: boolean;
  categoryId: number;
}

/**
 * The categories table renders three kinds of row through one column set so the
 * child rows line up with — and match the height of — their parent:
 *   - `category` — a top-level category (depth 0).
 *   - `variant`  — one of the category's variants (depth 1).
 *   - `add`      — a trailing affordance under each category for adding a new
 *                  variant (depth 1); not backed by data.
 * `getSubRows` returns the `variant` + `add` rows for each `category`, so
 * TanStack renders them as real sub-rows (nested surface + expander) rather than
 * a free-form block spanning every column.
 */
export type CategoryRow =
  | (ConfigCategoryWithVariants & { rowKind: "category" })
  | (VariantRow & { rowKind: "variant" })
  | { rowKind: "add"; id: string; name: string; categoryId: number };

export interface CategoryColumnHandlers {
  onEditCategory: (category: ConfigCategoryWithVariants) => void;
  onDeleteCategory: (category: ConfigCategoryWithVariants) => void;
  onToggleVariant: (variantId: number, isEnabled: boolean) => void;
  onEditVariant: (variant: VariantRow) => void;
  onDeleteVariant: (variant: VariantRow) => void;
  /** The category whose "add variant" row is currently in edit mode, if any. */
  addingVariantForCategory: number | null;
  isSubmitting: boolean;
  variantError: string | null;
  onAddVariantClick: (categoryId: number) => void;
  onVariantSubmit: (categoryId: number, name: string) => void;
  onVariantCancel: () => void;
}

/**
 * Inline "add a variant" form. Owns its own text state so typing never
 * re-renders the whole table (or rebuilds the column set); the parent is only
 * told about the final name on submit.
 */
function AddVariantRow({
  categoryId,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
  placeholder,
  saveLabel,
  cancelLabel,
}: {
  categoryId: number;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (categoryId: number, name: string) => void;
  onCancel: () => void;
  placeholder: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(categoryId, trimmed);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 ps-6">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="max-w-xs"
      />
      <Button
        size="sm"
        onClick={submit}
        disabled={isSubmitting || !name.trim()}
      >
        {saveLabel}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        {cancelLabel}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

export const useColumns = (
  tCommon: ReturnType<typeof useTranslations<"common">>,
  handlers: CategoryColumnHandlers
): ColumnDef<CategoryRow>[] => {
  const {
    onEditCategory,
    onDeleteCategory,
    onToggleVariant,
    onEditVariant,
    onDeleteVariant,
    addingVariantForCategory,
    isSubmitting,
    variantError,
    onAddVariantClick,
    onVariantSubmit,
    onVariantCancel,
  } = handlers;

  return useMemo(
    () => [
      {
        id: "name",
        // The trailing "add variant" row has no name; give it an undefined sort
        // key and pin undefined last so it stays at the bottom of a category's
        // variants regardless of sort direction (an empty string would sort to
        // the top under an ascending name sort).
        accessorFn: (row) => (row.rowKind === "add" ? undefined : row.name),
        sortUndefined: "last",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 500,
        cell: ({ row }) => {
          const data = row.original;

          if (data.rowKind === "variant") {
            return (
              <div className="flex items-center gap-2 ps-6">
                <Switch
                  checked={data.isEnabled}
                  onCheckedChange={() =>
                    onToggleVariant(data.id, data.isEnabled)
                  }
                  className="w-8 h-4"
                  aria-label={data.name}
                />
                <span className={data.isEnabled ? "" : "text-muted-foreground"}>
                  {data.name}
                </span>
              </div>
            );
          }

          if (data.rowKind === "add") {
            if (addingVariantForCategory === data.categoryId) {
              return (
                <AddVariantRow
                  categoryId={data.categoryId}
                  isSubmitting={isSubmitting}
                  error={variantError}
                  onSubmit={onVariantSubmit}
                  onCancel={onVariantCancel}
                  placeholder={tCommon("fields.placeholders.addVariant")}
                  saveLabel={tCommon("actions.save")}
                  cancelLabel={tCommon("cancel")}
                />
              );
            }
            return (
              <Button
                variant="link"
                className="ps-6 h-auto p-0 text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddVariantClick(data.categoryId);
                }}
              >
                <PlusCircle className="w-4 h-4" />
                {tCommon("fields.placeholders.addVariant")}
              </Button>
            );
          }

          return (
            <span
              className="cursor-pointer font-medium"
              onClick={() => row.toggleExpanded()}
            >
              {data.name}
            </span>
          );
        },
      },
      {
        id: "variants",
        accessorFn: (row) =>
          row.rowKind === "category" ? row.variants : undefined,
        header: tCommon("fields.variants"),
        enableSorting: false,
        enableResizing: true,
        enableHiding: false,
        size: 100,
        cell: ({ row }) => {
          const data = row.original;
          if (data.rowKind !== "category" || data.variants.length === 0) {
            return null;
          }
          return (
            <div className="text-center">
              <Popover>
                <PopoverTrigger
                  className="cursor-default"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge>
                    <Component className="w-4 h-4 me-1" />
                    {data.variants.length}
                  </Badge>
                </PopoverTrigger>
                <PopoverContent>
                  {data.variants.map((variant) => (
                    <Badge key={variant.id}>
                      {variant.isEnabled ? (
                        <CircleCheckBig className="w-4 h-4" />
                      ) : (
                        <CircleSlash2 className="w-4 h-4 text-destructive" />
                      )}
                      <span className="ms-1">{variant.name}</span>
                    </Badge>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableSorting: false,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 80,
        cell: ({ row }) => {
          const data = row.original;
          if (data.rowKind === "add") return null;

          const onEdit =
            data.rowKind === "variant"
              ? () => onEditVariant(data)
              : () => onEditCategory(data);
          const onDelete =
            data.rowKind === "variant"
              ? () => onDeleteVariant(data)
              : () => onDeleteCategory(data);

          return (
            <div
              className="whitespace-nowrap flex justify-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <Button
                variant="ghost"
                className="px-2 py-1 h-auto"
                onClick={onEdit}
                aria-label={tCommon("actions.edit")}
              >
                <SquarePen className="h-5 w-5" />
              </Button>
              <Button
                variant="destructive"
                className="px-2 py-1 h-auto"
                onClick={onDelete}
                aria-label={tCommon("actions.delete")}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            </div>
          );
        },
      },
    ],
    [
      tCommon,
      onEditCategory,
      onDeleteCategory,
      onToggleVariant,
      onEditVariant,
      onDeleteVariant,
      addingVariantForCategory,
      isSubmitting,
      variantError,
      onAddVariantClick,
      onVariantSubmit,
      onVariantCancel,
    ]
  );
};
