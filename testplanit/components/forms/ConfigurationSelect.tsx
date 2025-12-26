import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import { Combine } from "lucide-react";
import { useTranslations } from "next-intl";

// Utility function to transform configurations into configurationOptions
export const transformConfigurations = (
  configurations: {
    id: number;
    name: string;
  }[]
) => {
  return (
    configurations?.map((configuration) => ({
      value: configuration.id.toString(),
      label: configuration.name,
    })) || []
  );
};

export interface ConfigurationSelectProps {
  value: string | number | null | undefined;
  onChange: (value: string | number | null | undefined) => void;
  configurations: {
    value: string;
    label: string;
  }[];
  isLoading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export const ConfigurationSelect: React.FC<ConfigurationSelectProps> = ({
  value,
  onChange,
  configurations,
  isLoading = false,
  placeholder = "Select Configuration",
  disabled = false,
}) => {
  const tCommon = useTranslations("common");

  return (
    <Select
      onValueChange={(val) => onChange(val === "0" ? null : Number(val))}
      value={value ? value.toString() : "0"}
      disabled={
        disabled || isLoading || !configurations || configurations.length === 0
      }
    >
      <SelectTrigger>
        <SelectValue
          placeholder={tCommon("placeholders.selectConfiguration")}
        />
      </SelectTrigger>
      <SelectContent>
        {isLoading ? (
          <SelectItem value="loading">{tCommon("loading")}</SelectItem>
        ) : (
          <SelectGroup>
            <SelectItem value="0">{tCommon("labels.none")}</SelectItem>
            {configurations.map((configuration) => (
              <SelectItem key={configuration.value} value={configuration.value}>
                <div className="flex items-center gap-1">
                  <Combine className="w-4 h-4" />
                  {configuration.label}
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
};
