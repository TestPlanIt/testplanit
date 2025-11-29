"use client";

import { useFindManyTags, useCreateTags } from "~/lib/hooks";
import CreatableSelect from "react-select/creatable";
import Select from "react-select";
import { MultiValue } from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import { CirclePlus } from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { sanitizeName, replaceProblematicChars, type ClassValue } from "~/utils";

interface TagOption {
  readonly label: string;
  readonly value: number;
}

export interface ManageTagsProps {
  selectedTags: number[];
  setSelectedTags: (tags: number[]) => void;
  className?: ClassValue;
  canCreateTags?: boolean;
}

export function ManageTags({
  selectedTags,
  setSelectedTags,
  className = "",
  canCreateTags = false,
}: ManageTagsProps) {
  const [allTagOptions, setAllTagOptions] = useState<readonly TagOption[]>([]);
  const tCommon = useTranslations("common");
  const tTags = useTranslations("tags");

  const {
    data: tags,
    refetch,
    isLoading,
    isFetching,
  } = useFindManyTags({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
    select: { id: true, name: true },
  });

  useEffect(() => {
    if (tags) {
      setAllTagOptions(tags.map((tag) => ({ label: tag.name, value: tag.id })));
    }
  }, [tags]);

  const { mutateAsync: createTags, isPending: isCreating } = useCreateTags();

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  const handleTagChange = (newValue: MultiValue<TagOption>) => {
    const tagIds = newValue ? newValue.map((option) => option.value) : [];
    setSelectedTags(tagIds);
  };

  const handleCreateTag = async (tagName: string) => {
    if (tagName.trim() === "") return;
    try {
      // Sanitize the name before creating
      const sanitizedName = sanitizeName(tagName);
      if (sanitizedName === "") {
        console.error("Sanitized name is empty, cannot create tag.");
        // Optionally, provide user feedback here
        return;
      }

      const newTag = await createTags({
        data: { name: sanitizedName, isDeleted: false },
        select: { id: true, name: true },
      });
      if (newTag) {
        const newOption: TagOption = { label: newTag.name, value: newTag.id };
        setAllTagOptions([...allTagOptions, newOption]);
        setSelectedTags([...selectedTags, newTag.id]);
        refetch();
      }
    } catch (error) {
      console.error("Failed to create tag:", error);
    }
  };

  const formatCreateLabel = (inputValue: string) => (
    <div className="flex items-center">
      <CirclePlus className="mr-1 w-4 h-4 shrink-0" />
      <span>{tCommon("actions.createTag", { name: inputValue })}</span>
    </div>
  );

  const combinedLoading = isLoading || isFetching || isCreating;

  const valueForSelect = allTagOptions.filter((option) =>
    (selectedTags || []).includes(option.value)
  );

  const noOptionsMessage = ({ inputValue }: { inputValue: string }) => {
    if (inputValue) {
      return tCommon("actions.noTagsFound");
    }
    return tTags("manageTags.noOptions");
  };

  return (
    <div className={`min-w-[200px] space-y-2 ${className}`}>
      {canCreateTags ? (
        <CreatableSelect
          isMulti
          options={allTagOptions}
          value={valueForSelect}
          onChange={handleTagChange}
          onCreateOption={handleCreateTag}
          formatCreateLabel={formatCreateLabel}
          noOptionsMessage={noOptionsMessage}
          styles={customStyles}
          placeholder={
            combinedLoading
              ? tCommon("status.loading")
              : tTags("manageTags.searchOrAddPlaceholder")
          }
          className="mx-1"
          isDisabled={combinedLoading}
          isLoading={combinedLoading}
          onInputChange={(inputValue: any, actionMeta: any) => {
            if (actionMeta.action === "input-change") {
              return replaceProblematicChars(inputValue);
            }
            return inputValue;
          }}
        />
      ) : (
        <Select
          isMulti
          options={allTagOptions}
          value={valueForSelect}
          onChange={handleTagChange}
          noOptionsMessage={noOptionsMessage}
          styles={customStyles}
          placeholder={
            combinedLoading
              ? tCommon("status.loading")
              : tTags("manageTags.searchPlaceholder")
          }
          className="mx-1"
          isDisabled={combinedLoading}
          isLoading={combinedLoading}
        />
      )}
    </div>
  );
}
