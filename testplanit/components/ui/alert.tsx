import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/utils";

const alertVariants = cva(
  // Icon is vertically centered on the FIRST line of text for every alert
  // (single- or multi-line, with or without an AlertTitle). `top-3.5` sits the
  // h-4 icon's center on the text-sm line-box center (py-3 + half of the 20px
  // line). The legacy -3px description nudge is dropped so the lone-description
  // case stays aligned rather than shifting up off the icon.
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-3.5 [&>svg]:text-foreground [&>svg~*]:ps-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
