"use client";

/**
 * Admin CRUD for the SCIM `roles` core-attribute hybrid.
 *
 * Sits beside the fallback-default card because the two settings answer the
 * same operator question from opposite ends: the fallback default decides what
 * an *unmapped* directory user gets, and a role mapping decides what a user
 * the IdP made a specific assertion about gets. Role-derived tiers win over
 * group-derived ones, so every save runs the same downgrade preview the group
 * mapping flow uses before it commits.
 */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/ui/typography";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { DowngradedUser } from "~/app/actions/scimMappingActions";
import {
  previewRoleMappingChange,
  saveRoleMappingChange,
} from "~/app/actions/scimRoleMappingActions";
import type { Access } from "~/zenstack/models";

const ACCESS_OPTIONS: Access[] = ["NONE", "USER", "PROJECTADMIN", "ADMIN"];

/** Pending mutation held across the downgrade-confirm dialog. */
interface PendingChange {
  roleValue: string;
  newAccess: Access | null;
}

export function RoleMappingsCard() {
  const t = useTranslations("admin.scim");
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("admin.groups");

  const { data: mappings, refetch } = useClientQueries(
    schema
  ).scimRoleMapping.useFindMany({ orderBy: { roleValue: "asc" } });

  const [newRoleValue, setNewRoleValue] = useState("");
  const [newAccess, setNewAccess] = useState<Access>("USER");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [downgradedUsers, setDowngradedUsers] = useState<DowngradedUser[]>([]);

  const accessLabel = (access: Access) => {
    switch (access) {
      case "ADMIN":
        return tCommon("access.admin");
      case "PROJECTADMIN":
        return tCommon("access.projectAdmin");
      case "USER":
        return tCommon("access.user");
      default:
        return tCommon("access.none");
    }
  };

  const apply = async (change: PendingChange) => {
    setIsSaving(true);
    try {
      const result = await saveRoleMappingChange(
        change.roleValue,
        change.newAccess
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(t("roleMappings.saved"));
      setNewRoleValue("");
      await refetch();
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Preview first, and only fall through to the write when nobody loses
   * access. A role mapping can demote every holder of a directory-wide role in
   * one click, so the confirm step is not optional.
   */
  const requestChange = async (change: PendingChange) => {
    const trimmed = change.roleValue.trim();
    if (!trimmed) {
      toast.error(t("roleMappings.errorRoleRequired"));
      return;
    }

    const normalized = { ...change, roleValue: trimmed };
    setIsSaving(true);
    try {
      const preview = await previewRoleMappingChange(
        normalized.roleValue,
        normalized.newAccess
      );
      if (!preview.success) {
        toast.error(preview.error);
        return;
      }
      if (preview.downgraded.length > 0) {
        setDowngradedUsers(preview.downgraded);
        setPending(normalized);
        setConfirmOpen(true);
        return;
      }
    } finally {
      setIsSaving(false);
    }

    await apply(normalized);
  };

  return (
    <Card className="mt-6" data-testid="scim-role-mappings-card">
      <CardHeader>
        <SectionHeader className="flex items-center gap-2">
          <CardTitle>{t("roleMappings.title")}</CardTitle>
          <HelpPopover helpKey="scimRoleMappings" />
        </SectionHeader>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {t("roleMappings.description")}
        </p>

        <div className="space-y-2">
          {(mappings ?? []).map((mapping) => (
            <div
              key={mapping.roleValue}
              className="flex items-center gap-2"
              data-testid={`scim-role-mapping-row-${mapping.roleValue}`}
            >
              <span className="flex-1 font-mono text-sm truncate">
                {mapping.roleValue}
              </span>
              <Select
                value={mapping.mappedAccess}
                disabled={isSaving}
                onValueChange={(value) =>
                  requestChange({
                    roleValue: mapping.roleValue,
                    newAccess: value as Access,
                  })
                }
              >
                <SelectTrigger
                  className="w-48"
                  aria-label={t("roleMappings.accessLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_OPTIONS.map((access) => (
                    <SelectItem key={access} value={access}>
                      {accessLabel(access)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isSaving}
                aria-label={t("roleMappings.remove")}
                data-testid={`scim-role-mapping-delete-${mapping.roleValue}`}
                onClick={() =>
                  requestChange({
                    roleValue: mapping.roleValue,
                    newAccess: null,
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {(mappings ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("roleMappings.empty")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4 border-t pt-4">
          <Input
            className="flex-1"
            value={newRoleValue}
            disabled={isSaving}
            placeholder={t("roleMappings.rolePlaceholder")}
            aria-label={t("roleMappings.roleLabel")}
            data-testid="scim-role-mapping-value-input"
            onChange={(e) => setNewRoleValue(e.target.value)}
          />
          <Select
            value={newAccess}
            disabled={isSaving}
            onValueChange={(value) => setNewAccess(value as Access)}
          >
            <SelectTrigger
              className="w-48"
              data-testid="scim-role-mapping-access-select"
              aria-label={t("roleMappings.accessLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCESS_OPTIONS.map((access) => (
                <SelectItem key={access} value={access}>
                  {accessLabel(access)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            data-testid="scim-role-mapping-add"
            onClick={() =>
              requestChange({ roleValue: newRoleValue, newAccess })
            }
          >
            {t("roleMappings.add")}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tGroups("downgradeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tGroups("downgradeConfirmDescription", {
                count: downgradedUsers.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto px-6">
            {downgradedUsers.map((u) => (
              <li
                key={u.userId}
                className="flex items-center justify-between gap-3"
              >
                <UserNameCell userId={u.userId} hideLink={true} />
                <span className="text-muted-foreground whitespace-nowrap">
                  {tGroups("downgradeConfirmAccessChange", {
                    from: u.currentAccess,
                    to: u.newAccess,
                  })}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                if (pending) await apply(pending);
              }}
            >
              {tGroups("downgradeConfirmApplyAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
