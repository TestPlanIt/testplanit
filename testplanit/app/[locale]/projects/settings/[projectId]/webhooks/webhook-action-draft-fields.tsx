"use client";

import { TemplateNameDisplay } from "@/components/TemplateNameDisplay";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { GroupNameCell } from "@/components/tables/GroupNameCell";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import {
  DRAFT_QUANTITIES,
  readDraftCasesOptions,
  type DraftCasesOptions,
  type DraftQuantity,
} from "~/lib/webhooks/actions/schemas";
import { schema } from "~/zenstack/schema";
import { QUANTITY_LABEL_KEYS } from "./webhook-action-labels";

const DEFAULT_CHOICE = "default";

export interface DraftRecipient {
  id: string;
  name: string;
}

export interface DraftGroup {
  id: number;
  name: string;
}

export interface DraftCasesDraft {
  templateId: number | null;
  stateId: number | null;
  quantity: DraftQuantity;
  autoGenerateTags: boolean;
  notifyUsers: DraftRecipient[];
  notifyGroups: DraftGroup[];
}

export function draftCasesDraftFrom(saved: unknown): DraftCasesDraft {
  const options = readDraftCasesOptions(saved);
  return {
    templateId: options.templateId ?? null,
    stateId: options.stateId ?? null,
    quantity: options.quantity ?? "several",
    // On unless switched off, as in the Generate wizard.
    autoGenerateTags: options.autoGenerateTags ?? true,
    notifyUsers: (options.notifyUserIds ?? []).map((id) => ({ id, name: id })),
    notifyGroups: (options.notifyGroupIds ?? []).map((id) => ({
      id,
      name: String(id),
    })),
  };
}

/** The options to save, without anything left at its default. */
export function draftCasesOptionsFromDraft(
  draft: DraftCasesDraft
): DraftCasesOptions {
  return {
    ...(draft.templateId ? { templateId: draft.templateId } : {}),
    ...(draft.stateId ? { stateId: draft.stateId } : {}),
    quantity: draft.quantity,
    autoGenerateTags: draft.autoGenerateTags,
    ...(draft.notifyUsers.length
      ? { notifyUserIds: draft.notifyUsers.map((u) => u.id) }
      : {}),
    ...(draft.notifyGroups.length
      ? { notifyGroupIds: draft.notifyGroups.map((g) => g.id) }
      : {}),
  };
}

interface Props {
  projectId: number;
  value: DraftCasesDraft;
  onChange: (next: DraftCasesDraft) => void;
}

/**
 * How a rule drafts test cases: which template and state they take, how
 * many, whether to tag them, and who reviews them. The folder is the
 * rule's own, named after it.
 */
export function WebhookActionDraftFields({
  projectId,
  value,
  onChange,
}: Props) {
  const t = useTranslations("projects.settings.webhooks.actions");
  const tFields = useTranslations("common.fields");
  const tGenerate = useTranslations("repository.generateTestCases");
  const tPlaceholders = useTranslations("common.placeholders");
  const queries = useClientQueries(schema);

  const { data: templates } = queries.templates.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId } },
    },
    select: { id: true, templateName: true, isDefault: true },
    orderBy: { templateName: "asc" },
  });
  const { data: states } = queries.workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "CASES",
      projects: { some: { projectId } },
    },
    select: {
      id: true,
      name: true,
      isDefault: true,
      icon: { select: { name: true } },
      color: { select: { value: true } },
    },
    orderBy: { order: "asc" },
  });
  const { data: groups } = queries.groups.useFindMany({
    where: { isDeleted: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const defaultTemplate = templates?.find((template) => template.isDefault);
  const defaultState = states?.find((state) => state.isDefault);

  const fetchMembers = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const { results, total } = await searchProjectMembers(
        projectId,
        query,
        page,
        pageSize
      );
      return {
        results: results.map((m) => ({ id: m.id, name: m.name })),
        total,
      };
    },
    [projectId]
  );
  const fetchGroups = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const search = query.trim().toLowerCase();
      const all = (groups ?? []).filter((g) =>
        g.name.toLowerCase().includes(search)
      );
      const start = page * pageSize;
      return { results: all.slice(start, start + pageSize), total: all.length };
    },
    [groups]
  );

  const update = (next: Partial<DraftCasesDraft>) =>
    onChange({ ...value, ...next });

  return (
    <div className="space-y-3" data-testid="webhook-action-draft-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{tFields("template")}</Label>
          <Select
            value={value.templateId ? String(value.templateId) : DEFAULT_CHOICE}
            onValueChange={(next) =>
              update({
                templateId: next === DEFAULT_CHOICE ? null : Number(next),
              })
            }
          >
            <SelectTrigger data-testid="webhook-action-draft-template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_CHOICE}>
                <span className="inline-flex items-center gap-1">
                  {tFields("default")}
                  {defaultTemplate && (
                    <>
                      {" · "}
                      <TemplateNameDisplay
                        name={defaultTemplate.templateName}
                        size="sm"
                      />
                    </>
                  )}
                </span>
              </SelectItem>
              {(templates ?? []).map((template) => (
                <SelectItem key={template.id} value={String(template.id)}>
                  <TemplateNameDisplay name={template.templateName} size="sm" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{tFields("state")}</Label>
          <Select
            value={value.stateId ? String(value.stateId) : DEFAULT_CHOICE}
            onValueChange={(next) =>
              update({ stateId: next === DEFAULT_CHOICE ? null : Number(next) })
            }
          >
            <SelectTrigger data-testid="webhook-action-draft-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_CHOICE}>
                <span className="inline-flex items-center gap-1">
                  {tFields("default")}
                  {defaultState && (
                    <>
                      {" · "}
                      <WorkflowStateDisplay
                        state={{
                          name: defaultState.name,
                          icon: { name: defaultState.icon.name as never },
                          color: { value: defaultState.color.value },
                        }}
                        size="sm"
                      />
                    </>
                  )}
                </span>
              </SelectItem>
              {(states ?? []).map((state) => (
                <SelectItem key={state.id} value={String(state.id)}>
                  <WorkflowStateDisplay
                    state={{
                      name: state.name,
                      icon: { name: state.icon.name as never },
                      color: { value: state.color.value },
                    }}
                    size="sm"
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{tGenerate("addNotes.quantity")}</Label>
          <Select
            value={value.quantity}
            onValueChange={(next) =>
              update({ quantity: next as DraftQuantity })
            }
          >
            <SelectTrigger data-testid="webhook-action-draft-quantity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRAFT_QUANTITIES.map((quantity) => (
                <SelectItem key={quantity} value={quantity}>
                  {tGenerate(
                    `addNotes.quantityOptions.${QUANTITY_LABEL_KEYS[quantity]}`
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Label className="flex items-center gap-3">
        <Switch
          checked={value.autoGenerateTags}
          onCheckedChange={(autoGenerateTags: boolean) =>
            update({ autoGenerateTags })
          }
          data-testid="webhook-action-draft-tags"
        />
        <span>{tGenerate("autoGenerateTags")}</span>
      </Label>

      <div className="space-y-1.5">
        <Label>{tFields("users")}</Label>
        <MultiAsyncCombobox<DraftRecipient>
          value={value.notifyUsers}
          onValueChange={(next) => update({ notifyUsers: next })}
          fetchOptions={fetchMembers}
          renderOption={(member) => (
            <UserNameCell userId={member.id} hideLink />
          )}
          renderSelectedOption={(member) => (
            <UserNameCell userId={member.id} hideLink />
          )}
          getOptionValue={(member) => member.id}
          getOptionLabel={(member) => member.name}
          placeholder={tPlaceholders("selectUsers")}
          ariaLabel={tFields("users")}
          hideSelectAll
        />
      </div>
      <div className="space-y-1.5">
        <Label>{tFields("groups")}</Label>
        <MultiAsyncCombobox<DraftGroup>
          value={value.notifyGroups}
          onValueChange={(next) => update({ notifyGroups: next })}
          fetchOptions={fetchGroups}
          renderOption={(group) => <GroupNameCell groupId={String(group.id)} />}
          renderSelectedOption={(group) => (
            <GroupNameCell groupId={String(group.id)} />
          )}
          getOptionValue={(group) => group.id}
          getOptionLabel={(group) => group.name}
          placeholder={tPlaceholders("selectGroups")}
          ariaLabel={tFields("groups")}
          hideSelectAll
        />
        <p className="text-xs text-muted-foreground">{t("notifyHelp")}</p>
      </div>
    </div>
  );
}
