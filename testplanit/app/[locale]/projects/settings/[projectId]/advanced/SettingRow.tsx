"use client";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { HelpPopover } from "@/components/ui/help-popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import type { ReactNode } from "react";

/**
 * A titled, collapsible group of related settings. Each group remembers its
 * open/closed state per browser (via CollapsibleSection); the group's
 * explanation is the first line of its content.
 */
export function SettingsSection({
  title,
  description,
  storageKey,
  children,
  "data-testid": testId,
}: {
  title: ReactNode;
  /** One or two sentences on what the group governs. */
  description: string;
  /** localStorage key the collapsed state persists under. */
  storageKey: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <CollapsibleSection
      storageKey={storageKey}
      title={title}
      data-testid={testId}
    >
      <div className="space-y-4">
        <Text variant="muted">{description}</Text>
        {children}
      </div>
    </CollapsibleSection>
  );
}

/**
 * A setting's label with its description tucked into a "?" popover, so the
 * row stays a single line and the long explanation is one click away. The
 * popover sits outside the Label so opening it never toggles the control.
 */
export function SettingLabel({
  htmlFor,
  label,
  description,
}: {
  htmlFor: string;
  label: string;
  description: string;
}) {
  return (
    <span className="flex items-center">
      <Label htmlFor={htmlFor}>{label}</Label>
      <HelpPopover helpKey={`## ${label}\n\n${description}`} />
    </span>
  );
}

/** Switch-left settings row; `children` render beneath it (e.g. a warning). */
export function SwitchSetting({
  id,
  checked,
  onCheckedChange,
  disabled,
  label,
  description,
  children,
  "data-testid": testId,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          data-testid={testId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
        <SettingLabel htmlFor={id} label={label} description={description} />
      </div>
      {children}
    </div>
  );
}
