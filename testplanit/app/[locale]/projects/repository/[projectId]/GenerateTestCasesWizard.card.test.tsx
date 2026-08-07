import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    sharedStepGroup: {
      useFindMany: vi.fn(() => ({ data: [], isLoading: false })),
      useCreate: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    },
    sharedStepItem: {
      useFindMany: vi.fn(() => ({ data: [], isLoading: false })),
      useCreateMany: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    },
  }),
}));

vi.mock("~/app/actions/importGeneratedTestCases", () => ({
  importGeneratedTestCases: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "1" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(({ children }: any) => <a>{children}</a>),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
  usePathname: vi.fn(() => "/"),
  redirect: vi.fn(),
  getPathname: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-123" } },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
  useLocale: vi.fn(() => "en-US"),
}));

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "light" })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: vi.fn(({ content }: any) => (
    <div data-testid="tiptap-editor" data-content={JSON.stringify(content)}>
      TipTapEditor
    </div>
  )),
}));

import { GeneratedTestCaseCard } from "./GenerateTestCasesWizard";

Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

const ADMIN_OPTION_ID = 101;
const USER_OPTION_ID = 102;

const dropdownField = {
  order: 1,
  caseField: {
    id: 11,
    displayName: "Access Required",
    systemName: "access_required",
    type: { type: "Dropdown" },
    fieldOptions: [
      { fieldOption: { id: ADMIN_OPTION_ID, name: "Admin", order: 1 } },
      { fieldOption: { id: USER_OPTION_ID, name: "User", order: 2 } },
    ],
  },
};

const textField = {
  order: 2,
  caseField: {
    id: 12,
    displayName: "Preconditions",
    systemName: "preconditions",
    type: { type: "Text Long" },
    fieldOptions: [],
  },
};

const stepsField = {
  order: 3,
  caseField: {
    id: 13,
    displayName: "Steps",
    systemName: "steps",
    type: { type: "Steps" },
    fieldOptions: [],
  },
};

const template = { id: 1, caseFields: [dropdownField, textField, stepsField] };
const fieldIds = [11, 12, 13];

const generatedCase = {
  id: "gen-1",
  name: "Generated case",
  steps: [],
  fieldValues: {
    "Access Required": "Admin",
    Preconditions: "User is logged in",
    Steps: [{ step: "Do a thing", expectedResult: "It happens" }],
  },
  tags: [],
};

/**
 * Stands in for the wizard's review step. `churn` re-renders the card with
 * freshly built template and selection objects, the way a query refetch does.
 */
function ReviewStep({
  onSave,
  churnBeforeSave = false,
}: {
  onSave: (updated: any) => void;
  churnBeforeSave?: boolean;
}) {
  const [testCase, setTestCase] = useState<any>(generatedCase);
  const [isEditing, setIsEditing] = useState(false);
  const [churn, setChurn] = useState(0);
  const formSubmitHandlersRef = useRef(new Map<string, () => void>());

  return (
    <>
      {churnBeforeSave && (
        <button type="button" onClick={() => setChurn((c) => c + 1)}>
          refetch
        </button>
      )}
      <GeneratedTestCaseCard
        testCase={testCase}
        template={
          churn > 0
            ? { ...template, caseFields: [...template.caseFields] }
            : template
        }
        selectedFieldIds={new Set(fieldIds)}
        isSelected
        onSelectionChange={() => {}}
        isEditing={isEditing}
        onStartEdit={() => setIsEditing(true)}
        onCancelEdit={() => setIsEditing(false)}
        onSave={(updated: any) => {
          onSave(updated);
          setTestCase(updated);
          setIsEditing(false);
        }}
        autoGenerateTags={false}
        t={(key: string) => key}
        tCommon={(key: string) => key}
        session={{ user: { id: "user-123" } }}
        projectId={1}
        index={0}
        formSubmitHandlersRef={formSubmitHandlersRef}
      />
    </>
  );
}

const clickEdit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "actions.edit" }));

const clickSave = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "actions.save" }));

describe("GeneratedTestCaseCard — editing a generated case", () => {
  it("keeps a changed dropdown value after save and reopen", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ReviewStep onSave={onSave} />);

    await clickEdit(user);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "User" }));
    await clickSave(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].fieldValues["Access Required"]).toBe(
      USER_OPTION_ID
    );

    await clickEdit(user);
    expect((await screen.findByRole("combobox")).textContent).toContain("User");
  });

  it("keeps an added step after save and reopen", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ReviewStep onSave={onSave} />);

    await clickEdit(user);
    // One step renders two editors (step + expected result); Preconditions adds one.
    expect(screen.getAllByTestId("tiptap-editor")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "add" }));
    await clickSave(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].steps).toHaveLength(2);

    await clickEdit(user);
    expect(screen.getAllByTestId("tiptap-editor")).toHaveLength(5);
  });

  it("keeps pending edits when the card re-renders on refetched data", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ReviewStep onSave={onSave} churnBeforeSave />);

    await clickEdit(user);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "User" }));
    await user.click(screen.getByRole("button", { name: "add" }));

    await user.click(screen.getByRole("button", { name: "refetch" }));

    await clickSave(user);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].fieldValues["Access Required"]).toBe(
      USER_OPTION_ID
    );
    expect(onSave.mock.calls[0][0].steps).toHaveLength(2);
  });
});
