"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Avatar } from "@/components/Avatar";
import { Star } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";

export interface UserMentionProps {
  userId: string;
  /**
   * When set, the pill is rendered without a wrapping `<Link>`. Use this in
   * contexts where the parent already navigates (e.g. inside a Link that
   * jumps to the entity itself) and a nested link would be invalid HTML.
   */
  hideLink?: boolean;
  className?: ClassValue;
}

/**
 * Canonical "mention pill" used for inline references to a user inside
 * narrative text — banner sentences, dialog descriptions, attribution lines
 * that read like prose. Mirrors the chrome that the TipTap `@mention`
 * extension renders (`lib/tiptap/mentionExtension.tsx`) so a `@user` in a
 * comment body and a programmatic mention in a banner look identical.
 *
 * For non-narrative uses (table cells, comment headers) use the plain
 * `<UserNameCell>` instead — that variant ships its own avatar layout and
 * doesn't carry the inline-pill background.
 */
export function UserMention({
  userId,
  hideLink = false,
  className,
}: UserMentionProps) {
  const { data: user } = useClientQueries(schema).user.useFindFirst({
    where: { id: userId },
    select: { name: true, image: true, isDeleted: true },
  });
  const { data: session } = useSession();
  const tCommon = useTranslations("common");
  const isCurrentUser = userId === session?.user?.id;

  if (user?.isDeleted) {
    return (
      <span
        className="inline-flex items-center rounded-md border border-muted-foreground/50 bg-secondary px-1.5 py-0.5 text-secondary-foreground italic"
        data-testid="user-mention-deleted"
      >
        {tCommon("aria.deletedUser")}
      </span>
    );
  }

  if (!user) return null;

  const pillClass = cn(
    "inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-muted-foreground/50 bg-secondary px-1.5 py-0.5 align-middle text-secondary-foreground no-underline transition-colors",
    hideLink ? "" : "cursor-pointer hover:bg-secondary/80",
    className
  );

  const inner = (
    <>
      {/* Hidden from assistive tech so the link reads "Profile of <name>"
          without the initials. */}
      <span className="flex shrink-0" aria-hidden="true">
        <Avatar
          alt={user.name ?? ""}
          height={16}
          width={16}
          image={user.image ?? ""}
          showTooltip={false}
        />
      </span>
      {isCurrentUser && (
        <Star className="h-3 w-3 min-w-3 shrink-0 fill-current" />
      )}
      {/*
        Native `title` (not Radix `<Tooltip>`) so the full name surfaces
        on hover only when truncation actually trims it — Radix tooltips
        auto-show when the trigger is inside a Dialog focus trap, which
        flashes "Brad DerManouelian" on every reject/approve dialog open
        regardless of cursor position.
      */}
      <span className="max-w-[14rem] truncate" title={user.name ?? ""}>
        {user.name}
      </span>
    </>
  );

  if (hideLink) {
    return (
      <span className={pillClass} data-testid="user-mention">
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={`/users/profile/${userId}`}
      className={pillClass}
      data-testid="user-mention"
    >
      {/* Named from its content, not aria-label, so the visible name is part
          of the accessible name (WCAG 2.5.3 Label in Name). */}
      <span className="sr-only">{"Profile of "}</span>
      {inner}
    </Link>
  );
}
