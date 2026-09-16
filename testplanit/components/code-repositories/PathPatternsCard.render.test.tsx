import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { Form } from "@/components/ui/form";
import { PathPatternsCard } from "./PathPatternsCard";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, values?: object) => {
    const base = namespace ? `${namespace}.${key}` : key;
    return values ? `${base}:${JSON.stringify(values)}` : base;
  },
}));

function Harness(
  props: Partial<React.ComponentProps<typeof PathPatternsCard>>
) {
  const form = useForm({
    defaultValues: { pathPatterns: [{ path: "src", pattern: "**/*" }] },
  });
  return (
    <Form {...form}>
      <PathPatternsCard
        // The callers cast the same way; the card takes any form's control.
        control={form.control as any}
        description="Which files"
        pathPlaceholder="src"
        defaultPattern="**/*"
        testIdPrefix="t"
        isPreviewing={false}
        preview={null}
        previewProgress={null}
        onPreview={vi.fn()}
        {...props}
      />
    </Form>
  );
}

describe("PathPatternsCard", () => {
  it("renders the rows, the root hint, and adds a row with the default pattern", () => {
    render(<Harness />);

    expect(screen.getByTestId("t-path-0")).toHaveValue("src");
    expect(screen.getByTestId("t-pattern-0")).toHaveValue("**/*");
    expect(
      screen.getByText(
        /projects\.settings\.codeRepository\.pathPatterns\.rootHint/
      )
    ).toBeInTheDocument();
    // The only row cannot be removed.
    expect(
      screen.getByRole("button", { name: "common.actions.delete" })
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("t-add-path"));

    expect(screen.getByTestId("t-path-1")).toHaveValue("");
    expect(screen.getByTestId("t-pattern-1")).toHaveValue("**/*");
    expect(
      screen.getAllByRole("button", { name: "common.actions.delete" })[0]
    ).toBeEnabled();
  });

  it("hides editing controls and disables inputs when read-only", () => {
    render(<Harness readOnly />);

    expect(screen.queryByTestId("t-add-path")).toBeNull();
    expect(screen.getByTestId("t-path-0")).toBeDisabled();
  });

  it("drives the preview button and shows the result with extras", () => {
    const onPreview = vi.fn();
    const { rerender } = render(
      <Harness onPreview={onPreview} previewDisabled />
    );
    expect(screen.getByTestId("t-preview-button")).toBeDisabled();

    rerender(
      <Harness
        onPreview={onPreview}
        preview={{
          files: [{ path: "src/a.ts", size: 1 }],
          fileCount: 1,
          totalSize: 1,
          totalSizeFormatted: "1 B",
          exceedsLimit: false,
          overflowBytes: 0,
          truncated: true,
        }}
        previewExtras={<div data-testid="extras">extra</div>}
      />
    );
    fireEvent.click(screen.getByTestId("t-preview-button"));

    expect(onPreview).toHaveBeenCalled();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("extras")).toBeInTheDocument();
    expect(
      screen.getByText(
        "projects.settings.codeRepository.pathPatterns.truncatedBadge"
      )
    ).toBeInTheDocument();
  });

  it("shows a preview error", () => {
    render(
      <Harness
        preview={{
          files: [],
          fileCount: 0,
          totalSize: 0,
          totalSizeFormatted: "0 B",
          exceedsLimit: false,
          overflowBytes: 0,
          truncated: false,
          error: "Rate limited",
        }}
      />
    );
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
  });
});
