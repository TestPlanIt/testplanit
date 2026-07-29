import DynamicIcon from "@/components/DynamicIcon";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { CaretSortIcon } from "@radix-ui/react-icons";
import { FolderOpen } from "lucide-react"; // Default folder icon
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo } from "react";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";

// Utility function to transform folders into FolderSelectOptions
export const transformFolders = (
  folders: {
    id: number;
    name: string;
    parentId: number | null;
    // Add other folder properties if needed, e.g. icon
  }[]
) => {
  return (
    folders?.map((folder) => ({
      value: folder.id.toString(),
      label: folder.name,
      parentId: folder.parentId,
      // icon: folder.icon ? { name: folder.icon.name as IconName } : null, // Example if folders have icons
    })) || []
  );
};

export interface FolderSelectOption {
  value: string;
  label: string;
  parentId: number | null;
  icon?: { name?: IconName } | null;
}

/** A folder with its depth, so a flat searchable list keeps the tree's shape. */
export interface FlatFolderOption extends FolderSelectOption {
  level: number;
}

const INDENT_PER_LEVEL = 10;
const INDENT_BASE = 5;

/**
 * Flattens the hierarchy depth-first, so the list reads top-down in the same
 * order as the tree and each entry knows how deep it sits. Options whose parent
 * is absent from the list are appended at the root rather than dropped, so a
 * partial folder set can never hide a selectable folder.
 */
export const flattenFolderOptions = (
  folders: FolderSelectOption[]
): FlatFolderOption[] => {
  const childrenByParent = new Map<number | null, FolderSelectOption[]>();
  folders.forEach((folder) => {
    const parentKey = folder.parentId ?? null;
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey)!.push(folder);
  });

  const flat: FlatFolderOption[] = [];
  const visited = new Set<string>();

  const walk = (parentId: number | null, level: number) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      if (visited.has(folder.value)) continue;
      visited.add(folder.value);
      flat.push({ ...folder, level });
      const folderId = Number(folder.value);
      if (Number.isFinite(folderId)) walk(folderId, level + 1);
    }
  };

  walk(null, 0);

  folders.forEach((folder) => {
    if (visited.has(folder.value)) return;
    visited.add(folder.value);
    flat.push({ ...folder, level: 0 });
  });

  return flat;
};

/**
 * Narrows the list to name matches, keeping each match's ancestors so the
 * indentation still describes where the match sits. Ancestors stay selectable —
 * they are ordinary folders.
 */
export const filterFolderOptions = (
  flat: FlatFolderOption[],
  query: string
): FlatFolderOption[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return flat;

  const byValue = new Map(flat.map((option) => [option.value, option]));
  const keep = new Set<string>();

  flat.forEach((option) => {
    if (!option.label.toLowerCase().includes(needle)) return;
    keep.add(option.value);
    let parentId = option.parentId;
    while (parentId !== null && parentId !== undefined) {
      const parent = byValue.get(String(parentId));
      if (!parent || keep.has(parent.value)) break;
      keep.add(parent.value);
      parentId = parent.parentId;
    }
  });

  return flat.filter((option) => keep.has(option.value));
};

export interface FolderSelectProps {
  value: string | number | null | undefined;
  onChange: (value: string | number | null | undefined) => void;
  folders: FolderSelectOption[];
  isLoading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const FolderSelect: React.FC<FolderSelectProps> = ({
  value,
  onChange,
  folders,
  isLoading = false,
  placeholder, // Use default from translations
  disabled = false,
  className,
}) => {
  const tCommon = useTranslations("common");
  const tRepository = useTranslations("repository");

  const displayPlaceholder = placeholder || tRepository("cases.selectFolder");

  const flatOptions = useMemo(
    () => flattenFolderOptions(folders ?? []),
    [folders]
  );

  // AsyncCombobox keeps fetchOptions in an effect dependency list, so this must
  // stay referentially stable between renders.
  const fetchOptions = useCallback(
    (query: string) => Promise.resolve(filterFolderOptions(flatOptions, query)),
    [flatOptions]
  );

  const selected = useMemo(() => {
    if (value === null || value === undefined || value === "") return null;
    const target = String(value);
    return flatOptions.find((option) => option.value === target) ?? null;
  }, [flatOptions, value]);

  const triggerLabel = selected
    ? selected.label
    : isLoading
      ? tCommon("loading")
      : displayPlaceholder;

  return (
    <AsyncCombobox<FlatFolderOption>
      value={selected}
      onValueChange={(option) =>
        onChange(!option || option.value === "none" ? null : option.value)
      }
      fetchOptions={fetchOptions}
      getOptionValue={(option) => option.value}
      placeholder={displayPlaceholder}
      disabled={disabled || isLoading || flatOptions.length === 0}
      showPagination={false}
      minDropdownWidth={320}
      renderOption={(option) => (
        <div
          className="flex items-center gap-1 min-w-0"
          style={{
            paddingInlineStart: option.level * INDENT_PER_LEVEL + INDENT_BASE,
          }}
        >
          {option.icon?.name ? (
            <DynamicIcon
              className="w-4 h-4 shrink-0"
              name={option.icon.name as IconName}
            />
          ) : (
            <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{option.label}</span>
        </div>
      )}
      renderTrigger={() => (
        <button
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background focus:outline-hidden focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {triggerLabel}
          </span>
          <CaretSortIcon className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      )}
    />
  );
};
