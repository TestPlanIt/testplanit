import { useState, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string, values?: Record<string, unknown>) => {
    if (values && typeof values.count === "number") {
      return `${key}:${values.count}`;
    }
    return key;
  }),
}));

vi.mock("~/utils/randomPassword", () => ({
  generateRandomPassword: vi.fn(() => "RANDOM_PASS"),
}));

vi.mock("~/app/[locale]/admin/fields/AddCaseField", () => ({
  AddCaseFieldModal: () => null,
}));

vi.mock("~/app/[locale]/admin/fields/AddResultField", () => ({
  AddResultFieldModal: () => null,
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyColor: () => ({ data: [] }),
  useFindManyStatusScope: () => ({ data: [] }),
}));

type SelectContextValue = {
  value: string;
  onValueChange?: (value: string) => void;
};

const SelectContext = createContext<SelectContextValue>({ value: "" });

vi.mock("@/components/ui/select", () => {
  const Select = ({
    value = "",
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  );

  const SelectTrigger = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  const SelectContent = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  const SelectValue = ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder ?? ""}</span>
  );

  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children?: ReactNode;
  }) => {
    const context = useContext(SelectContext);
    return (
      <button type="button" onClick={() => context.onValueChange?.(value)}>
        {children}
      </button>
    );
  };

  const SelectGroup = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  const SelectLabel = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  return {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
    SelectGroup,
    SelectLabel,
  };
});

vi.mock("@prisma/client", () => ({
  Access: {
    ADMIN: "ADMIN",
    PROJECTADMIN: "PROJECTADMIN",
    USER: "USER",
    NONE: "NONE",
  },
  ApplicationArea: {
    ClosedTestRuns: "ClosedTestRuns",
    ClosedSessions: "ClosedSessions",
    Documentation: "Documentation",
    TestCaseRestrictedFields: "TestCaseRestrictedFields",
    TestRunResultRestrictedFields: "TestRunResultRestrictedFields",
    SessionsRestrictedFields: "SessionsRestrictedFields",
    Tags: "Tags",
    TestRuns: "TestRuns",
    Sessions: "Sessions",
  },
}));

import TestmoMappingConfigurator from "./TestmoMappingConfigurator";
import { createEmptyMappingConfiguration } from "~/services/imports/testmo/configuration";
import type { TestmoMappingAnalysis } from "~/services/imports/testmo/types";
import { generateRandomPassword } from "~/utils/randomPassword";

if (typeof HTMLElement !== "undefined") {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
}

describe("TestmoMappingConfigurator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a random password when switching a user to create", async () => {
    const analysis: TestmoMappingAnalysis = {
      summary: {
        projects: 0,
        users: 1,
        testCases: 0,
        testRuns: 0,
        sessions: 0,
        workflows: 0,
        statuses: 0,
        roles: 0,
        configurations: 0,
        groups: 0,
        templates: 0,
        templateFields: 0,
        customFields: 0,
        milestoneTypes: 0,
        integrations: 0,
        issues: 0,
      },
      requiresConfiguration: true,
      ambiguousEntities: {
        workflows: [],
        statuses: [],
        roles: [],
        configurations: [],
        milestoneTypes: [],
        groups: [],
        tags: [],
        issueTargets: [],
        users: [
          {
            id: 1,
            email: "user@example.com",
            name: "User Example",
            isActive: true,
            isApi: false,
          },
        ],
        templates: [],
        templateFields: [],
      },
      existingEntities: {
        workflows: [],
        statuses: [],
        roles: [],
        configurationCategories: [],
        configurationVariants: [],
        configurations: [],
        milestoneTypes: [],
        groups: [],
        tags: [],
        issueTargets: [],
        users: [],
        caseFields: [],
        resultFields: [],
        caseFieldTypes: [],
        templates: [],
      },
      preservedDatasets: {
        users: [],
      },
    };

    const onConfigChange = vi.fn();

    const Wrapper = () => {
      const [config, setConfig] = useState(createEmptyMappingConfiguration());
      return (
        <TestmoMappingConfigurator
          analysis={analysis}
          configuration={config}
          onConfigurationChange={(nextConfig) => {
            setConfig(nextConfig);
            onConfigChange(nextConfig);
          }}
          datasetKey="users"
          visibleSections={{
            users: true,
            workflows: false,
            statuses: false,
            roles: false,
            groups: false,
            milestoneTypes: false,
            configurations: false,
          }}
        />
      );
    };

    render(<Wrapper />);
    const user = userEvent.setup();

    const createOption = await screen.findByRole("button", {
      name: "actionCreate",
    });
    await user.click(createOption);

    expect(generateRandomPassword).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(onConfigChange).toHaveBeenCalled();
    });

    const latestConfig = onConfigChange.mock.calls.at(-1)?.[0];
    expect(latestConfig?.users[1]?.password).toBe("RANDOM_PASS");

    const passwordInput = await screen.findByPlaceholderText(
      "userPasswordPlaceholder"
    );
    expect(passwordInput).toHaveValue("RANDOM_PASS");
  });
});
