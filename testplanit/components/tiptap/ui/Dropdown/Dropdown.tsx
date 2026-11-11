import { cn } from "~/utils";

export const DropdownCategoryTitle = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <div className="mb-1 px-1.5 text-[.65rem] font-semibold text-neutral-500 uppercase dark:text-neutral-400">
      {children}
    </div>
  );
};

export const DropdownButton = ({
  children,
  isActive,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) => {
  const buttonClass = cn(
    "flex w-full items-center gap-2 rounded bg-transparent p-1.5 text-start text-sm font-medium text-neutral-700 dark:text-neutral-300",
    !isActive && !disabled,
    "hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200",
    isActive &&
      !disabled &&
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200",
    disabled && "cursor-not-allowed text-neutral-400 dark:text-neutral-500",
    className
  );

  return (
    <button
      type="button"
      className={buttonClass}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
