import { Input } from "@/components/ui/input";
import { useRef, memo, useCallback } from "react";

interface FilterProps {
  placeholder: string;
  searchString: string;
  setSearchString: (value: string) => void;
}

const FilterComponent = ({
  placeholder,
  searchString,
  setSearchString,
}: FilterProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Use a callback ref to maintain focus
  const setInputRef = useCallback((element: HTMLInputElement | null) => {
    if (element) {
      // Only set focus if the element doesn't already have it
      if (document.activeElement !== element) {
        element.focus();
      }
    }
    inputRef.current = element;
  }, []);

  return (
    <Input
      ref={setInputRef}
      type="text"
      placeholder={placeholder}
      value={searchString}
      onChange={(e) => setSearchString(e.target.value)}
    />
  );
};

FilterComponent.displayName = "Filter";

export const Filter = memo(FilterComponent);
