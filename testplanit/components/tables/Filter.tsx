import { useDebounce } from "@/components/Debounce";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { cn } from "~/utils";

interface FilterProps {
  initialSearchString?: string;
  placeholder?: string;
  onSearchChange: (value: string) => void;
  dataTestId?: string;
  /** Applied to the wrapper — lets callers size the search box. */
  className?: string;
}

const Filter: React.FC<FilterProps> = ({
  initialSearchString = "",
  onSearchChange,
  placeholder,
  dataTestId,
  className,
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
    <div className={cn("relative w-full max-w-lg", className)}>
      <Input
        placeholder={placeholder || t("filter")}
        value={inputValue}
        onChange={handleChange}
        className="w-full ps-8"
        data-testid={dataTestId}
      />
    </div>
  );
};

export { Filter };
