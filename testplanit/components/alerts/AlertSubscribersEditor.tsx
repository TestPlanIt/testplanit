"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { schema } from "~/zenstack/schema";

export interface SubscriberEntry {
  userId: string;
  name?: string;
}

interface MemberOption {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

/**
 * The audience of an alert as one multi-select of project members. Project
 * admins add and remove anyone; everyone else sees the list and a button to
 * follow or leave it themselves.
 */
export function AlertSubscribersEditor({
  projectId,
  subscribers,
  currentUserId,
  creatorId,
  canManageOthers,
  busy = false,
  onAdd,
  onRemove,
}: {
  projectId: number;
  subscribers: SubscriberEntry[];
  currentUserId: string | undefined;
  /** Shown with a star; the creator is in the audience by default. */
  creatorId?: string | null;
  canManageOthers: boolean;
  busy?: boolean;
  onAdd: (member: { id: string; name: string }) => void | Promise<void>;
  onRemove: (userId: string) => void | Promise<void>;
}) {
  const t = useTranslations("alerts.form");
  const client = useClientQueries(schema);

  // Names and avatars for the current audience (the rule row carries ids only).
  const ids = useMemo(() => subscribers.map((s) => s.userId), [subscribers]);
  const { data: users } = client.user.useFindMany(
    {
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true, image: true },
    },
    { enabled: ids.length > 0 }
  );
  const selected: MemberOption[] = useMemo(() => {
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    return subscribers.map((s) => {
      const u = byId.get(s.userId);
      return {
        id: s.userId,
        name: u?.name ?? s.name ?? s.userId,
        email: u?.email ?? null,
        image: u?.image ?? null,
      };
    });
  }, [subscribers, users]);

  const fetchOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const result = await searchProjectMembers(
        projectId,
        query,
        page,
        pageSize
      );
      return { results: result.results, total: result.total };
    },
    [projectId]
  );

  const handleChange = (next: MemberOption[]) => {
    const before = new Set(selected.map((m) => m.id));
    const after = new Set(next.map((m) => m.id));
    for (const member of next) {
      if (!before.has(member.id))
        void onAdd({ id: member.id, name: member.name });
    }
    for (const member of selected) {
      if (!after.has(member.id)) void onRemove(member.id);
    }
  };

  const isSelf = currentUserId != null && ids.includes(currentUserId);

  const renderMember = (option: MemberOption) => (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      data-testid={`alert-member-option-${option.id}`}
    >
      <span className="inline-flex h-5 w-5 shrink-0">
        <Avatar
          image={option.image}
          alt={option.name}
          width={20}
          height={20}
          showTooltip={false}
        />
      </span>
      {option.id === creatorId && (
        <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
      )}
      <span className="truncate">{option.name}</span>
      {option.id === currentUserId && (
        <span className="text-xs text-muted-foreground">
          {"("}
          {t("you")}
          {")"}
        </span>
      )}
    </span>
  );

  return (
    <div className="space-y-3" data-testid="alert-subscribers">
      <MultiAsyncCombobox<MemberOption>
        value={selected}
        onValueChange={handleChange}
        fetchOptions={fetchOptions}
        renderOption={renderMember}
        renderSelectedOption={renderMember}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.name}
        placeholder={t("searchMembers")}
        ariaLabel={t("audience")}
        disabled={busy || !canManageOthers}
        className="w-full"
        hideSelectAll
      />
      {!canManageOthers && currentUserId && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t("cannotManageSubscribers")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            data-testid="alert-subscriber-self-toggle"
            onClick={() =>
              isSelf
                ? void onRemove(currentUserId)
                : void onAdd({ id: currentUserId, name: "" })
            }
          >
            {isSelf ? t("leaveAlert") : t("followAlert")}
          </Button>
        </div>
      )}
    </div>
  );
}
