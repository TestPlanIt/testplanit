import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Form } from "@/components/ui/form";

vi.mock("@/components/tiptap/TipTapEditor", () => ({ default: () => null }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
  useLocale: () => "en-US",
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));

import { DynamicJiraField } from "./dynamic-jira-field";

class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  for (const [prop, value] of [
    ["offsetHeight", 400],
    ["offsetWidth", 300],
    ["clientHeight", 400],
    ["clientWidth", 300],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      value,
    });
  }
});

const formRef: { current: UseFormReturn<any> | null } = { current: null };

function Harness({
  field,
  knownSprint,
}: {
  field: any;
  knownSprint?: { id: string; name: string };
}) {
  const form = useForm<any>({ defaultValues: {} });
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  return (
    <Form {...form}>
      <DynamicJiraField
        field={field}
        form={form}
        integrationId={7}
        projectKey="PROJ"
        knownSprint={knownSprint}
      />
    </Form>
  );
}

function renderField(field: any, knownSprint?: { id: string; name: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness field={field} knownSprint={knownSprint} />
    </QueryClientProvider>
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DynamicJiraField", () => {
  it("offers the project's open sprints for the Sprint field and stores the chosen sprint id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sprints: [
          { id: "11", name: "Sprint 11", state: "ACTIVE" },
          { id: "12", name: "Sprint 12", state: "FUTURE" },
        ],
      }),
    });

    renderField({
      key: "customfield_10101",
      name: "Sprint",
      required: false,
      schema: {
        type: "array",
        items: "string",
        custom: "com.pyxis.greenhopper.jira:gh-sprint",
      },
    });

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Sprint" }));
    fireEvent.click(await screen.findByText("Sprint 12"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/7/sprints?projectKey=PROJ"
    );
    expect(formRef.current!.getValues("customfield_10101")).toBe("12");
  });

  it("shows a sprint set from outside the picker by the name the form knows it by", async () => {
    renderField(
      {
        key: "customfield_10101",
        name: "Sprint",
        required: false,
        schema: {
          type: "array",
          items: "string",
          custom: "com.pyxis.greenhopper.jira:gh-sprint",
        },
      },
      { id: "42", name: "Sprint 42" }
    );
    expect(
      screen.getByRole("combobox", { name: "Sprint" }).textContent
    ).not.toContain("Sprint 42");

    act(() => {
      formRef.current!.reset({ customfield_10101: "42" });
    });

    expect(
      screen.getByRole("combobox", { name: "Sprint" }).textContent
    ).toContain("Sprint 42");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a user search for a multi-user field and stores the chosen user ids", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          { accountId: "alice", displayName: "Alice" },
          { accountId: "bob", displayName: "Bob" },
        ],
        total: 2,
      }),
    });

    renderField({
      key: "customfield_10300",
      name: "Reviewers",
      required: false,
      schema: { type: "array", items: "user" },
    });

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Reviewers" }));
    fireEvent.click(await screen.findByText("Bob"));

    expect(formRef.current!.getValues("customfield_10300")).toEqual(["bob"]);
  });

  it("stores a number field as a number", () => {
    renderField({
      key: "customfield_10002",
      name: "Story Points",
      required: false,
      schema: { type: "number" },
    });

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });
    expect(formRef.current!.getValues("customfield_10002")).toBe(5);

    fireEvent.change(input, { target: { value: "" } });
    expect(formRef.current!.getValues("customfield_10002")).toBeUndefined();
  });

  it("does not treat a Server field that happens to be customfield_10001 as Team", () => {
    renderField({
      key: "customfield_10001",
      name: "Epic Link",
      required: false,
      schema: {
        type: "any",
        custom: "com.pyxis.greenhopper.jira:gh-epic-link",
      },
    });

    expect(screen.queryByText("noTeamsAvailable")).toBeNull();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
});
