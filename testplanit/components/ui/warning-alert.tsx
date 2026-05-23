import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "~/utils";

/**
 * Warning-styled wrapper around shadcn's `Alert` primitive.
 *
 * shadcn's `alertVariants` cva only ships `default` + `destructive` upstream.
 * Rather than fork `alert.tsx` to add a third variant (which would mean a
 * 3-way merge every time we sync the shadcn primitive), we compose the
 * warning treatment here once and route every warning-tone surface through
 * this wrapper. If the design system ever ships a real warning variant, we
 * swap this file for a `variant="warning"` consumer with no churn at the
 * call sites.
 *
 * Tokens (`text-warning`, `bg-warning`, `border-warning`) are already
 * defined in the project's Tailwind config; consumers should NOT redefine
 * them here.
 *
 * Color contract: the warning treatment lives on the border + icon + alert
 * title only. Body text inherits `text-foreground` so the description stays
 * readable in every theme — the amber body text shipped originally fell
 * below WCAG AA contrast on several themes (Light + System tokens both
 * suffered). The icon and AlertTitle still carry the amber accent so the
 * "warning" signal is preserved.
 */
const WarningAlert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <Alert
    ref={ref}
    className={cn(
      "border-warning/50 bg-warning/15 text-foreground [&>svg]:text-warning [&_h5]:text-warning",
      className
    )}
    {...props}
  />
));
WarningAlert.displayName = "WarningAlert";

export { WarningAlert };
