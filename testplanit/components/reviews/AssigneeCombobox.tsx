"use client";

import { Avatar } from "@/components/Avatar";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { useQuery } from "@tanstack/react-query";
import { Shield, User as UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { getProjectEligibleRoles } from "~/app/actions/getProjectEligibleRoles";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";

export type AssigneeOption =
  | {
      kind: "user";
      id: string;
      name: string;
      image: string | null;
      roleName: string | null;
    }
  | {
      kind: "role";
      id: number;
      name: string;
      userCount: number;
    };

interface AssigneeComboboxProps {
  projectId: number;
  value: AssigneeOption | null;
  onValueChange: (value: AssigneeOption | null) => void;
  disabled?: boolean;
}

export function AssigneeCombobox({
  projectId,
  value,
  onValueChange,
  disabled,
}: AssigneeComboboxProps) {
  const t = useTranslations();

  // Project-scoped roles: only roles whose holders have effective access to
  // this project. A role with no project-eligible holders is a dead-end
  // assignment — the decide path would resolve it to zero reviewers — so
  // hiding it from the picker prevents that footgun. Counts are also
  // project-scoped so the "{n} users hold this role" subtitle matches the
  // actual eligible-reviewer count for the assignment.
  //
  // Filtering by `name` substring still happens client-side after the
  // server action returns (TestPlanIt installs typically have a handful
  // of roles, so a single read suffices).
  const { data: rolesData } = useQuery({
    queryKey: ["assignee-combobox", "eligible-roles", projectId],
    queryFn: () => getProjectEligibleRoles(projectId),
    enabled: typeof projectId === "number" && projectId > 0,
    staleTime: 30_000,
  });

  const fetchOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      // Users are paginated server-side; roles are filtered client-side and
      // only included on page 0 (where the merged "users-then-roles" view
      // makes sense). Subsequent pages show only users.
      const userPage = await searchProjectMembers(
        projectId,
        query,
        page,
        pageSize
      );

      const userOptions: AssigneeOption[] = userPage.results.map((u) => ({
        kind: "user",
        id: u.id,
        name: u.name,
        image: u.image,
        // searchProjectMembers does not return effective role per user; the
        // detail role subtitle is a future enhancement. Null is the honest
        // current value rather than a misleading placeholder.
        roleName: null,
      }));

      const allRoles = rolesData ?? [];
      const roleOptions: AssigneeOption[] =
        page === 0
          ? allRoles
              .filter((r) =>
                query.trim().length === 0
                  ? true
                  : r.name.toLowerCase().includes(query.trim().toLowerCase())
              )
              .map((r) => ({
                kind: "role",
                id: r.id,
                name: r.name,
                userCount: r.userCount,
              }))
          : [];

      // Users grouped first, then roles — visual ordering per D-03.
      return {
        results: [...userOptions, ...roleOptions],
        total: userPage.total + (page === 0 ? roleOptions.length : 0),
      };
    },
    [projectId, rolesData]
  );

  return (
    <AsyncCombobox<AssigneeOption>
      value={value}
      onValueChange={onValueChange}
      fetchOptions={fetchOptions}
      renderOption={(option) =>
        option.kind === "user" ? (
          <UserOptionRow option={option} />
        ) : (
          <RoleOptionRow
            option={option}
            usersHoldRoleLabel={t("reviews.requester.usersHoldRole", {
              count: option.userCount,
            })}
          />
        )
      }
      getOptionValue={(option) => `${option.kind}:${option.id}`}
      placeholder={t("reviews.requester.assigneePlaceholder")}
      disabled={disabled}
      pageSize={20}
      showTotal
      renderTrigger={({ defaultContent }) => (
        <button
          type="button"
          data-testid="assignee-combobox"
          className="flex w-full items-center justify-start rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
        >
          {defaultContent}
        </button>
      )}
    />
  );
}

function UserOptionRow({
  option,
}: {
  option: Extract<AssigneeOption, { kind: "user" }>;
}) {
  return (
    <div
      data-testid={`assignee-option-user-${option.id}`}
      className="flex w-full items-center"
    >
      <span data-kind-icon="user" className="mr-2 inline-flex h-5 w-5">
        {option.image ? (
          <Avatar
            image={option.image}
            alt={option.name}
            width={20}
            height={20}
          />
        ) : (
          <UserIcon className="h-5 w-5" />
        )}
      </span>
      <div className="flex flex-col">
        <span className="text-sm">{option.name}</span>
        {option.roleName ? (
          <span className="text-xs text-muted-foreground">
            {option.roleName}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RoleOptionRow({
  option,
  usersHoldRoleLabel,
}: {
  option: Extract<AssigneeOption, { kind: "role" }>;
  usersHoldRoleLabel: string;
}) {
  return (
    <div
      data-testid={`assignee-option-role-${option.id}`}
      className="flex w-full items-center"
    >
      <span data-kind-icon="role" className="mr-2 inline-flex h-5 w-5">
        <Shield className="h-5 w-5" />
      </span>
      <div className="flex flex-col">
        <span className="text-sm">{option.name}</span>
        <span className="text-xs text-muted-foreground">
          {usersHoldRoleLabel}
        </span>
      </div>
    </div>
  );
}
