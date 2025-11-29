import React, { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { useDebounce } from "@/components/Debounce";

interface FilterProps {
  initialSearchString?: string;
  placeholder?: string;
  onSearchChange: (value: string) => void;
  dataTestId?: string;
}

const Filter: React.FC<FilterProps> = ({
  initialSearchString = "",
  onSearchChange,
  placeholder,
  dataTestId,
}) => {
  const t = useTranslations("common.table");
  const [inputValue, setInputValue] = useState(initialSearchString);
  const debouncedInputValue = useDebounce(inputValue, 300);

  useEffect(() => {
    onSearchChange(debouncedInputValue);
  }, [debouncedInputValue, onSearchChange]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  return (
    <div className="relative">
      <Input
        placeholder={placeholder || t("filter")}
        value={inputValue}
        onChange={handleChange}
        className="max-w-lg pl-8"
        data-testid={dataTestId}
      />
    </div>
  );
};

export { Filter };
