import * as React from "react";
import { Check, ChevronsUpDown, UserX } from "lucide-react";
import { cn, type ClassValue } from "~/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { useTranslations } from "next-intl";

interface User {
  id: string;
  name: string;
  email?: string;
  image?: string | null;
}

interface ComboboxProps {
  users: User[];
  value?: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  className?: ClassValue;
  disabled?: boolean;
  showUnassigned?: boolean;
}

export function Combobox({
  users,
  value,
  onValueChange,
  placeholder,
  className,
  disabled = false,
  showUnassigned = true,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const t = useTranslations("repository.columns");
  const [search, setSearch] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [width, setWidth] = React.useState<number>(200);

  // Update width when trigger element changes size
  React.useEffect(() => {
    if (!triggerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(triggerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Filter users based on search input
  const filteredUsers = React.useMemo(() => {
    if (!search) return users;
    const searchLower = search.toLowerCase();
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(searchLower) ||
        user.email?.toLowerCase().includes(searchLower)
    );
  }, [users, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-[200px] justify-between bg-transparent hover:bg-muted",
            className
          )}
          disabled={disabled}
        >
          {value !== null && value !== undefined && value !== "unassigned" ? (
            <UserNameCell userId={value} hideLink />
          ) : showUnassigned ? (
            <div className="flex items-center">
              <UserX className="mr-2 h-4 w-4" />
              <span>{t("unassigned")}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0"
        style={{ width: Math.max(width, 200) }}
      >
        <Command className="w-full" shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t("unassigned")}</CommandEmpty>
            <CommandGroup>
              {showUnassigned && (
                <CommandItem
                  value="unassigned"
                  onSelect={() => {
                    onValueChange(null);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <div className="flex items-center">
                    <UserX className="mr-2 h-4 w-4" />
                    <span>{t("unassigned")}</span>
                  </div>
                  {!value && (
                    <Check className="ml-auto h-4 w-4 text-muted-foreground" />
                  )}
                </CommandItem>
              )}
              {filteredUsers.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.name}
                  onSelect={() => {
                    onValueChange(user.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <UserNameCell userId={user.id} hideLink />
                  {value === user.id && (
                    <Check className="ml-auto h-4 w-4 text-muted-foreground" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
