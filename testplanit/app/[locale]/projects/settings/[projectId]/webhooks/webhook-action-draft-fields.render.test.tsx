import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTemplates,
  mockStates,
  mockGroups,
  mockUsers,
  mockSearch,
  comboboxes,
} = vi.hoisted(() => ({
  mockTemplates: vi.fn(),
  mockStates: vi.fn(),
  mockGroups: vi.fn(),
  mockUsers: vi.fn(),
  mockSearch: vi.fn(),
  comboboxes: new Map<string, any>(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    `${ns ? `${ns}.` : ""}${key}`,
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    templates: { useFindMany: (...a: unknown[]) => mockTemplates(...a) },
    workflows: { useFindMany: (...a: unknown[]) => mockStates(...a) },
    groups: { useFindMany: (...a: unknown[]) => mockGroups(...a) },
    user: { useFindMany: (...a: unknown[]) => mockUsers(...a) },
  }),
}));
vi.mock("~/app/actions/searchProjectMembers", () => ({
  searchProjectMembers: (...a: unknown[]) => mockSearch(...a),
}));
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: (props: any) => {
    comboboxes.set(props.ariaLabel, props);
    return (
      <div data-testid={`combobox-${props.ariaLabel}`}>
        {props.value.map((v: any) => props.getOptionLabel(v)).join("|")}
      </div>
    );
  },
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      data-testid={
        (
          React.Children.toArray(children).find(
            (c: any) => c?.props?.["data-testid"]
          ) as any
        )?.props?.["data-testid"]
      }
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: any) => <span>User {userId}</span>,
}));
vi.mock("@/components/tables/GroupNameCell", () => ({
  GroupNameCell: ({ groupId }: any) => <span>Group {groupId}</span>,
}));
vi.mock("@/components/TemplateNameDisplay", () => ({
  TemplateNameDisplay: ({ name }: any) => <span>{name}</span>,
}));
vi.mock("@/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: ({ state }: any) => (
    <span data-testid="state-display">{state.name}</span>
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      data-testid={rest["data-testid"]}
    />
  ),
}));

import {
  WebhookActionDraftFields,
  draftCasesDraftFrom,
  draftCasesOptionsFromDraft,
  type DraftCasesDraft,
} from "./webhook-action-draft-fields";

const USERS = "common.fields.users";
const GROUPS = "common.fields.groups";

const emptyDraft: DraftCasesDraft = {
  templateId: null,
  stateId: null,
  quantity: "several",
  autoGenerateTags: true,
  notifyUsers: [],
  notifyGroups: [],
};

function Harness({ initial }: { initial: DraftCasesDraft }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <WebhookActionDraftFields
        projectId={7}
        value={value}
        onChange={setValue}
      />
      <pre data-testid="draft">
        {JSON.stringify(draftCasesOptionsFromDraft(value))}
      </pre>
    </>
  );
}

describe("draft fields helpers", () => {
  it("reads saved options into a draft and writes a draft back compactly", () => {
    const draft = draftCasesDraftFrom({
      templateId: 4,
      stateId: 9,
      quantity: "few",
      autoGenerateTags: false,
      notifyUserIds: ["u1"],
      notifyGroupIds: [2],
    });
    expect(draft).toEqual({
      templateId: 4,
      stateId: 9,
      quantity: "few",
      autoGenerateTags: false,
      notifyUsers: [{ id: "u1", name: "u1" }],
      notifyGroups: [{ id: 2, name: "2" }],
    });
    expect(draftCasesOptionsFromDraft(draft)).toEqual({
      templateId: 4,
      stateId: 9,
      quantity: "few",
      autoGenerateTags: false,
      notifyUserIds: ["u1"],
      notifyGroupIds: [2],
    });
    // Nothing saved means the wizard's defaults: several cases, tags on.
    expect(draftCasesDraftFrom(undefined)).toEqual(emptyDraft);
    expect(draftCasesOptionsFromDraft(emptyDraft)).toEqual({
      quantity: "several",
      autoGenerateTags: true,
    });
  });
});

describe("WebhookActionDraftFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comboboxes.clear();
    mockTemplates.mockReturnValue({
      data: [{ id: 4, templateName: "Functional", isDefault: true }],
    });
    mockStates.mockReturnValue({
      data: [
        {
          id: 8,
          name: "Draft",
          isDefault: true,
          icon: { name: "Pencil" },
          color: { value: "#654321" },
        },
        {
          id: 9,
          name: "Review",
          isDefault: false,
          icon: { name: "Eye" },
          color: { value: "#123456" },
        },
      ],
    });
    mockGroups.mockReturnValue({
      data: [
        { id: 2, name: "QA" },
        { id: 3, name: "Dev" },
      ],
    });
    mockUsers.mockReturnValue({ data: [{ id: "u1", name: "Ada" }] });
    mockSearch.mockResolvedValue({
      results: [{ id: "u2", name: "Bob", email: null, image: null }],
      total: 1,
    });
  });

  it("offers the project's templates, states and the wizard's counts, with Default first", () => {
    render(<Harness initial={emptyDraft} />);
    const template = screen.getByTestId(
      "webhook-action-draft-template"
    ) as HTMLSelectElement;
    expect([...template.options].map((o) => o.value)).toEqual(["default", "4"]);
    // The Default choices say which template and state that is.
    expect(template.options[0].textContent).toBe(
      "common.fields.default · Functional"
    );
    const state = screen.getByTestId(
      "webhook-action-draft-state"
    ) as HTMLSelectElement;
    expect([...state.options].map((o) => o.textContent)).toEqual([
      "common.fields.default · Draft",
      "Draft",
      "Review",
    ]);
    // States are shown through the shared state display.
    expect(
      screen.getAllByTestId("state-display").map((n) => n.textContent)
    ).toEqual(["Draft", "Draft", "Review"]);
    const quantity = screen.getByTestId(
      "webhook-action-draft-quantity"
    ) as HTMLSelectElement;
    expect([...quantity.options].map((o) => o.value)).toEqual([
      "just_one",
      "couple",
      "few",
      "several",
      "many",
      "all",
    ]);
    expect(quantity.value).toBe("several");
    fireEvent.change(template, { target: { value: "4" } });
    fireEvent.change(state, { target: { value: "9" } });
    fireEvent.change(quantity, { target: { value: "few" } });
    // Tags start on; the switch turns them off.
    fireEvent.click(screen.getByTestId("webhook-action-draft-tags"));
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({
      templateId: 4,
      stateId: 9,
      quantity: "few",
      autoGenerateTags: false,
    });
  });

  it("shows recipients through the user and group cells and searches members and groups", async () => {
    render(
      <Harness
        initial={{
          ...emptyDraft,
          notifyUsers: [{ id: "u1", name: "u1" }],
          notifyGroups: [{ id: 2, name: "2" }],
        }}
      />
    );
    const users = comboboxes.get(USERS);
    const groups = comboboxes.get(GROUPS);
    render(<>{users.renderSelectedOption({ id: "u1", name: "u1" })}</>);
    render(<>{groups.renderSelectedOption({ id: 2, name: "2" })}</>);
    expect(screen.getByText("User u1")).toBeInTheDocument();
    expect(screen.getByText("Group 2")).toBeInTheDocument();
    expect(users.placeholder).toBe("common.placeholders.selectUsers");
    expect(groups.placeholder).toBe("common.placeholders.selectGroups");

    await expect(users.fetchOptions("bo", 0, 10)).resolves.toEqual({
      results: [{ id: "u2", name: "Bob" }],
      total: 1,
    });
    expect(mockSearch).toHaveBeenCalledWith(7, "bo", 0, 10);
    await expect(groups.fetchOptions("de", 0, 10)).resolves.toEqual({
      results: [{ id: 3, name: "Dev" }],
      total: 1,
    });
  });
});
