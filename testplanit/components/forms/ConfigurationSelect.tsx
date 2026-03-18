import { AsyncCombobox } from "@/components/ui/async-combobox";
import { CircleSlash2, Combine } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { searchConfigurations } from "~/app/actions/searchConfigurations";
import { useFindFirstConfigurations } from "~/lib/hooks";
import { cn, type ClassValue } from "~/utils";

type ConfigOption = { id: number; name: string };

export interface ConfigurationSelectProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  className?: ClassValue;
}

export const ConfigurationSelect: React.FC<ConfigurationSelectProps> = ({
  value,
  onChange,
  disabled = false,
  className,
}) => {
  const tCommon = useTranslations("common");

  // Resolve the current value's name for display
  const { data: currentConfig } = useFindFirstConfigurations(
    {
      where: { id: value ?? undefined },
      select: { id: true, name: true },
    },
  );

  const resolvedValue: ConfigOption | null =
    value && currentConfig ? { id: currentConfig.id, name: currentConfig.name } : null;

  return (
    <AsyncCombobox<ConfigOption>
      value={resolvedValue}
      onValueChange={(opt) => onChange(opt ? opt.id : null)}
      fetchOptions={(query, page, pageSize) =>
        searchConfigurations(query, page, pageSize)
      }
      renderOption={(opt) => (
        <div className="flex items-center gap-1 min-w-0">
          <Combine className="w-4 h-4 shrink-0" />
          <span className="truncate">{opt.name}</span>
        </div>
      )}
      getOptionValue={(opt) => opt.id}
      placeholder=""
      disabled={disabled}
      className={cn("w-full overflow-hidden", className)}
      pageSize={20}
      showTotal={true}
      showUnassigned={true}
      unassignedLabel={tCommon("access.none")}
      unassignedIcon={<CircleSlash2 className="mr-2 h-4 w-4" />}
    />
  );
};
