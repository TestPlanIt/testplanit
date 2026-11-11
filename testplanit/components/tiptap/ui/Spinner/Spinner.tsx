import { forwardRef, HTMLProps } from "react";
import { cn } from "~/utils";

export const Spinner = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  ({ className, ...rest }, ref) => {
    const spinnerClass = cn(
      "h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
      className
    );

    return <div className={spinnerClass} ref={ref} {...rest} />;
  }
);

Spinner.displayName = "Spinner";
