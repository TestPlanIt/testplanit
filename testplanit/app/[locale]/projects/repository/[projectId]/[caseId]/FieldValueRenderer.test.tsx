import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "1", caseId: "1" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => {
    return (key: string, _values?: any) => key;
  }),
  useLocale: vi.fn(() => "en-US"),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-123" } },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "light" })),
}));

// Mock TipTapEditor
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: vi.fn(({ content, readOnly }: { content?: any; readOnly?: boolean }) => (
    <div
      data-testid="tiptap-editor"
      data-content={JSON.stringify(content)}
      data-readonly={readOnly ? "true" : "false"}
    >
      TipTapEditor
    </div>
  )),
}));

// Mock DynamicIcon
vi.mock("@/components/DynamicIcon", () => ({
  default: vi.fn(({ name }: { name?: string }) => (
    <span data-testid="dynamic-icon" data-name={name}>
      icon
    </span>
  )),
}));

// Mock DateFormatter
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: vi.fn(({ date }: { date?: any }) => (
    <span data-testid="date-formatter">{date ? "2024-01-01" : ""}</span>
  )),
}));

// Mock DatePickerField
vi.mock("@/components/forms/DatePickerField", () => ({
  DatePickerField: vi.fn(() => (
    <div data-testid="date-picker-field">DatePicker</div>
  )),
}));

// Mock navigation Link
vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(
    ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
      [key: string]: any;
    }) => (
      <a href={href} {...props}>
        {children}
      </a>
    )
  ),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}));

// Mock StepsForm
vi.mock("../StepsForm", () => ({
  default: vi.fn(() => <div data-testid="steps-form">StepsForm</div>),
}));

// Mock StepsDisplay
vi.mock("./StepsDisplay", () => ({
  StepsDisplay: vi.fn(() => (
    <div data-testid="steps-display">StepsDisplay</div>
  )),
}));

// Mock StepsResults
vi.mock("./StepsResults", () => ({
  StepsResults: vi.fn(() => (
    <div data-testid="steps-results">StepsResults</div>
  )),
}));

// Mock react-select
vi.mock("react-select", () => ({
  default: vi.fn(
    ({ value, _options, _onChange }: { value?: any; _options?: any[]; _onChange?: any }) => (
      <div data-testid="multi-select">
        {Array.isArray(value)
          ? value.map((v: any) => <span key={v.value}>{v.label}</span>)
          : null}
      </div>
    )
  ),
}));

// Mock styles
vi.mock("~/styles/multiSelectStyles", () => ({
  getCustomStyles: vi.fn(() => ({})),
}));

// Mock utils
vi.mock("~/utils/tiptapConversion", () => ({
  ensureTipTapJSON: vi.fn((val: any) => val),
}));

// Mock react-hook-form Controller
vi.mock("react-hook-form", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-hook-form")>();
  return {
    ...original,
    Controller: vi.fn(
      ({
        render,
        defaultValue,
      }: {
        render: (props: { field: any }) => React.ReactNode;
        defaultValue?: any;
      }) =>
        render({
          field: {
            onChange: vi.fn(),
            value: defaultValue ?? "",
            name: "",
            ref: vi.fn(),
            onBlur: vi.fn(),
          },
        })
    ),
  };
});

// Mock app constants
vi.mock("~/app/constants", () => ({
  emptyEditorContent: { type: "doc", content: [] },
}));

import React from "react";
import FieldValueRenderer from "./FieldValueRenderer";

const makeTemplate = (fieldId: number, fieldType: string, fieldOptions: any[] = []) => ({
  caseFields: [
    {
      caseField: {
        id: fieldId,
        systemName: `field-${fieldId}`,
        fieldType,
        fieldOptions: fieldOptions.map((opt) => ({
          fieldOption: opt,
        })),
        defaultValue: null,
        initialHeight: null,
      },
    },
  ],
  resultFields: [],
});

const defaultProps = {
  caseId: "1",
  session: { user: { preferences: { dateFormat: "MM/DD/YYYY", timezone: "UTC" } } },
  isEditMode: false,
  isSubmitting: false,
  control: {},
  errors: {},
};

describe("FieldValueRenderer", () => {
  describe("Text String field", () => {
    it("renders plain text value in view mode", () => {
      const template = makeTemplate(1, "Text String");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="Hello World"
          fieldType="Text String"
          template={template}
          fieldId={1}
        />
      );

      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    it("renders Input in edit mode", () => {
      const template = makeTemplate(1, "Text String");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="Edit Value"
          fieldType="Text String"
          template={template}
          fieldId={1}
          isEditMode={true}
        />
      );

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("Text Long field", () => {
    it("renders TipTapEditor in view mode", () => {
      const template = makeTemplate(2, "Text Long");
      const content = JSON.stringify({ type: "doc", content: [] });

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={content}
          fieldType="Text Long"
          template={template}
          fieldId={2}
        />
      );

      expect(screen.getByTestId("tiptap-editor")).toBeInTheDocument();
    });

    it("renders TipTapEditor in edit mode", () => {
      const template = makeTemplate(2, "Text Long");
      const content = JSON.stringify({ type: "doc", content: [] });

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={content}
          fieldType="Text Long"
          template={template}
          fieldId={2}
          isEditMode={true}
        />
      );

      expect(screen.getByTestId("tiptap-editor")).toBeInTheDocument();
    });
  });

  describe("Dropdown field", () => {
    it("renders selected option name in view mode", () => {
      const template = makeTemplate(3, "Dropdown", [
        { id: 10, name: "Option A", icon: { name: "circle" }, iconColor: { value: "#ff0000" } },
        { id: 11, name: "Option B", icon: { name: "circle" }, iconColor: { value: "#00ff00" } },
      ]);

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={10}
          fieldType="Dropdown"
          template={template}
          fieldId={3}
        />
      );

      expect(screen.getByText("Option A")).toBeInTheDocument();
    });
  });

  describe("Multi-Select field", () => {
    it("renders selected option names in view mode", () => {
      const template = makeTemplate(4, "Multi-Select", [
        { id: 20, name: "Tag Alpha", icon: { name: "circle" }, iconColor: { value: "#ff0000" } },
        { id: 21, name: "Tag Beta", icon: { name: "circle" }, iconColor: { value: "#00ff00" } },
      ]);

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={[20, 21]}
          fieldType="Multi-Select"
          template={template}
          fieldId={4}
        />
      );

      expect(screen.getByText("Tag Alpha")).toBeInTheDocument();
      expect(screen.getByText("Tag Beta")).toBeInTheDocument();
    });
  });

  describe("Date field", () => {
    it("renders DateFormatter in view mode", () => {
      const template = makeTemplate(5, "Date");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="2024-01-15"
          fieldType="Date"
          template={template}
          fieldId={5}
        />
      );

      expect(screen.getByTestId("date-formatter")).toBeInTheDocument();
    });

    it("renders DatePickerField in edit mode", () => {
      const template = makeTemplate(5, "Date");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="2024-01-15"
          fieldType="Date"
          template={template}
          fieldId={5}
          isEditMode={true}
        />
      );

      expect(screen.getByTestId("date-picker-field")).toBeInTheDocument();
    });
  });

  describe("Number/Integer fields", () => {
    it("renders numeric value in view mode", () => {
      const template = makeTemplate(6, "Number");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={42}
          fieldType="Number"
          template={template}
          fieldId={6}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("renders integer value in view mode", () => {
      const template = makeTemplate(7, "Integer");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={100}
          fieldType="Integer"
          template={template}
          fieldId={7}
        />
      );

      expect(screen.getByText("100")).toBeInTheDocument();
    });

    it("renders Input in edit mode", () => {
      const template = makeTemplate(6, "Number");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={42}
          fieldType="Number"
          template={template}
          fieldId={6}
          isEditMode={true}
        />
      );

      expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    });
  });

  describe("Checkbox field", () => {
    it("renders checked Switch when value is true", () => {
      const template = makeTemplate(8, "Checkbox");

      const { container } = render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={true}
          fieldType="Checkbox"
          template={template}
          fieldId={8}
        />
      );

      // Checkbox field renders a Switch component (disabled in view mode)
      const switchEl = container.querySelector('[role="switch"]');
      expect(switchEl).toBeInTheDocument();
      expect(switchEl).toHaveAttribute("aria-checked", "true");
    });

    it("renders unchecked Switch when value is false", () => {
      const template = makeTemplate(8, "Checkbox");

      const { container } = render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={false}
          fieldType="Checkbox"
          template={template}
          fieldId={8}
        />
      );

      const switchEl = container.querySelector('[role="switch"]');
      expect(switchEl).toBeInTheDocument();
      expect(switchEl).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("Link field", () => {
    it("renders clickable anchor link in view mode", () => {
      const template = makeTemplate(9, "Link");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="https://example.com"
          fieldType="Link"
          template={template}
          fieldId={9}
        />
      );

      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "https://example.com");
      expect(link).toHaveTextContent("https://example.com");
    });

    it("renders URL input in edit mode", () => {
      const template = makeTemplate(9, "Link");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="https://example.com"
          fieldType="Link"
          template={template}
          fieldId={9}
          isEditMode={true}
        />
      );

      const input = screen.getByRole("textbox");
      expect(input).toBeInTheDocument();
    });
  });

  describe("Steps field", () => {
    it("renders StepsForm in edit mode", () => {
      const template = makeTemplate(10, "Steps");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={[]}
          fieldType="Steps"
          template={template}
          fieldId={10}
          isEditMode={true}
          projectId={1}
        />
      );

      expect(screen.getByTestId("steps-form")).toBeInTheDocument();
    });

    it("renders StepsDisplay in view mode", () => {
      const template = makeTemplate(10, "Steps");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={[]}
          fieldType="Steps"
          template={template}
          fieldId={10}
          isEditMode={false}
          projectId={1}
        />
      );

      expect(screen.getByTestId("steps-display")).toBeInTheDocument();
    });

    it("renders StepsResults in run mode", () => {
      const template = makeTemplate(10, "Steps");
      // Use non-empty steps so isEmptyValue returns false
      const mockSteps = [{ id: 1, step: null, expectedResult: null, sharedStepGroupId: null }];

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={mockSteps}
          fieldType="Steps"
          template={template}
          fieldId={10}
          isEditMode={false}
          isRunMode={true}
          projectId={1}
          stepsForDisplay={mockSteps as any}
        />
      );

      expect(screen.getByTestId("steps-results")).toBeInTheDocument();
    });
  });

  describe("Empty/null values", () => {
    it("renders empty for null Text String", () => {
      const template = makeTemplate(1, "Text String");

      const { container } = render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue={null}
          fieldType="Text String"
          template={template}
          fieldId={1}
        />
      );

      // Field container should be present but text content minimal
      const fieldDiv = container.querySelector('[data-testid="field-value-field-1"]');
      expect(fieldDiv).toBeInTheDocument();
    });

    it("renders error message when validation error present", () => {
      const template = makeTemplate(1, "Text String");

      render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue=""
          fieldType="Text String"
          template={template}
          fieldId={1}
          errors={{ 1: { message: "This field is required" } }}
        />
      );

      expect(screen.getByText("This field is required")).toBeInTheDocument();
    });

    it("renders with testid based on field systemName", () => {
      const template = makeTemplate(1, "Text String");

      const { container } = render(
        <FieldValueRenderer
          {...defaultProps}
          fieldValue="test"
          fieldType="Text String"
          template={template}
          fieldId={1}
        />
      );

      expect(container.querySelector('[data-testid="field-value-field-1"]')).toBeInTheDocument();
    });
  });
});
