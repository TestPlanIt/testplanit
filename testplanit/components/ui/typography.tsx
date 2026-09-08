import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/utils";

/**
 * Shared typography scale — one source of truth for text roles.
 *
 * Reach for the named components (`PageTitle`, `SectionTitle`, `Text`) instead
 * of hand-rolling classes so headings and copy stay consistent across screens
 * rather than drifting between e.g. `text-2xl font-bold` and
 * `text-2xl font-semibold`.
 *
 *   pageTitle     24px / semibold   Top-of-page heading (one per page)
 *   sectionTitle  18px / semibold   Section heading within a page
 *   subtitle      14px / muted      Supporting line beneath a title
 *   body          14px              Default body copy (app default density)
 *   muted         14px / muted      De-emphasized body copy / help text
 *   label         14px / medium     Field & control labels
 *   caption       12px / muted      Metadata: counts, timestamps, hints
 */
export const typographyVariants = cva("", {
  variants: {
    variant: {
      pageTitle: "text-2xl font-semibold tracking-tight",
      sectionTitle: "text-lg font-semibold",
      subtitle: "text-sm text-muted-foreground",
      body: "text-sm",
      muted: "text-sm text-muted-foreground",
      label: "text-sm font-medium",
      caption: "text-xs text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

type TypographyVariant = NonNullable<
  VariantProps<typeof typographyVariants>["variant"]
>;

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Override the rendered heading element to keep the document outline intact. */
  as?: HeadingTag;
}

/**
 * The primary heading of a page. Defaults to `<h2>` to match the app's existing
 * markup; pass `as="h1"` where the title is the page's sole top-level heading.
 */
export function PageTitle({
  as: Tag = "h2",
  className,
  ...props
}: HeadingProps) {
  return (
    <Tag
      className={cn(typographyVariants({ variant: "pageTitle" }), className)}
      {...props}
    />
  );
}

/** A section heading within a page. Defaults to `<h3>`. */
export function SectionTitle({
  as: Tag = "h3",
  className,
  ...props
}: HeadingProps) {
  return (
    <Tag
      className={cn(typographyVariants({ variant: "sectionTitle" }), className)}
      {...props}
    />
  );
}

/**
 * The large, primary-tinted header row at the top of a card or page section —
 * it typically holds the section's title alongside its actions, so it renders a
 * `<div>` rather than a heading element. Distinct from `SectionTitle`, which is
 * a plain in-page subheading. Pass layout (flex, spacing) via `className`; the
 * typographic look is fixed here so every section header stays uniform.
 */
export function SectionHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-primary text-xl md:text-2xl", className)}
      {...props}
    />
  );
}

type TextTag = "p" | "span" | "div";

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. Defaults to `<p>`. */
  as?: TextTag;
  /** Text role from the scale. Defaults to `body`. */
  variant?: Exclude<TypographyVariant, "pageTitle" | "sectionTitle">;
}

/** Body-level copy: `body` (default), `muted`, `subtitle`, `label`, `caption`. */
export function Text({
  as: Tag = "p",
  variant = "body",
  className,
  ...props
}: TextProps) {
  return (
    <Tag
      className={cn(typographyVariants({ variant }), className)}
      {...props}
    />
  );
}
