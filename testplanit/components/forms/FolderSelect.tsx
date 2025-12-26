import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { useTranslations } from "next-intl";
import { FolderOpen } from "lucide-react"; // Default folder icon

// Utility function to transform folders into FolderSelectOptions
export const transformFolders = (
  folders: {
    id: number;
    name: string;
    parentId: number | null;
    // Add other folder properties if needed, e.g., icon
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

export interface FolderSelectProps {
  value: string | number | null | undefined;
  onChange: (value: string | number | null | undefined) => void;
  folders: FolderSelectOption[];
  isLoading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const renderFolderOptions = (
  folders: FolderSelectOption[],
  parentId: number | null = null,
  level: number = 0
): React.ReactElement[] => {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .map((folder) => (
      <React.Fragment key={folder.value}>
        <SelectItem
          value={folder.value}
          style={{ paddingLeft: `${level * 10 + 5}px` }}
        >
          <div className="flex items-center gap-1 max-w-[600px]">
            {folder.icon?.name ? (
              <DynamicIcon
                className="w-4 h-4 shrink-0"
                name={folder.icon.name as IconName}
              />
            ) : (
              <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{folder.label}</span>
          </div>
        </SelectItem>
        {renderFolderOptions(folders, parseInt(folder.value), level + 1)}
      </React.Fragment>
    ));
};

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

  return (
    <Select
      onValueChange={(val) => {
        // console.log("[FolderSelect onValueChange internal] Received val:", val);
        onChange(val === "none" ? null : val);
      }}
      value={value ? value.toString() : ""} // Reverted from undefined
      disabled={disabled || isLoading || !folders || folders.length === 0}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={displayPlaceholder} />
      </SelectTrigger>
      <SelectContent>
        {isLoading ? (
          <SelectItem value="loading" disabled>
            {tCommon("loading")}
          </SelectItem>
        ) : folders && folders.length > 0 ? (
          <SelectGroup>{renderFolderOptions(folders)}</SelectGroup>
        ) : (
          <SelectItem value="no-folders" disabled>
            {tRepository("emptyFolders")}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
};
