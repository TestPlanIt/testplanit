"use client";

import { Avatar } from "@/components/Avatar";
import { Star } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { useFindFirstUser } from "~/lib/hooks";
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
  const { data: user } = useFindFirstUser({
    where: { id: userId },
    select: { name: true, image: true, isDeleted: true },
  });
  const { data: session } = useSession();
  const t = useTranslations("users");
  const isCurrentUser = userId === session?.user?.id;

  if (user?.isDeleted) {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-muted-foreground/50 italic"
        data-testid="user-mention-deleted"
      >
        {t("deletedUser")}
      </span>
    );
  }

  if (!user) return null;

  const pillClass = cn(
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-muted-foreground/50 transition-colors align-middle max-w-[16rem] no-underline",
    hideLink ? "" : "hover:bg-secondary/80 cursor-pointer",
    className
  );

  const inner = (
    <>
      <Avatar
        alt={user.name ?? ""}
        height={16}
        width={16}
        image={user.image ?? ""}
        showTooltip={false}
      />
      {isCurrentUser && (
        <Star className="w-3 h-3 min-w-3 fill-current shrink-0" />
      )}
      {/*
        Native `title` (not Radix `<Tooltip>`) so the full name surfaces
        on hover only when truncation actually trims it — Radix tooltips
        auto-show when the trigger is inside a Dialog focus trap, which
        flashes "Brad DerManouelian" on every reject/approve dialog open
        regardless of cursor position.
      */}
      <span className="truncate max-w-[14rem]" title={user.name ?? ""}>
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
      aria-label={`Profile of ${user.name}`}
      data-testid="user-mention"
    >
      {inner}
    </Link>
  );
}
