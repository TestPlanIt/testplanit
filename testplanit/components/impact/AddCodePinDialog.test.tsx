import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
  useLocale: () => "en-US",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, ...props }: any) => (
    <div data-testid={props["data-testid"] ?? "dialog-content"}>{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

const comboboxes: Record<
  string,
  {
    fetchOptions: (q: string, p: number, s: number) => Promise<any>;
    pick: (option: any) => void;
  }
> = {};
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({
    fetchOptions,
    onValueChange,
    renderTrigger,
    ariaLabel,
    value,
  }: any) => {
    comboboxes[ariaLabel] = { fetchOptions, pick: onValueChange };
    return renderTrigger({ value, defaultContent: <span>pick</span> });
  },
}));

vi.mock("@/components/code/CodeViewer", () => ({
  CodeViewer: ({ code, language, selection, onSelectionChange }: any) => (
    <div
      data-testid="code-viewer"
      data-language={language}
      data-selection={JSON.stringify(selection)}
    >
      <pre>{code}</pre>
      <button
        type="button"
        data-testid="code-viewer-pick"
        onClick={() => onSelectionChange([3, 5])}
      />
      <button
        type="button"
        data-testid="code-viewer-clear"
        onClick={() => onSelectionChange(null)}
      />
    </div>
  ),
}));

vi.mock("~/lib/utils/codeLanguageFromPath", () => ({
  codeLanguageFromPath: (path: string) =>
    path.endsWith(".ts") ? "typescript" : "text",
}));

import { AddCodePinDialog } from "./AddCodePinDialog";

const FILE_COMBOBOX = "repository.codePins.fileLabel";
const CASE_COMBOBOX = "repository.codePins.caseLabel";
const SYMBOL_COMBOBOX = "repository.codePins.symbolLabel";

const FILES = [
  { path: "src/payments/checkout.ts", size: 10 },
  { path: "src/payments/refund.ts", size: 20 },
  { path: "src/app.ts", size: 30 },
];

let filesResponse: { status: number; body: unknown } = {
  status: 200,
  body: {
    files: FILES,
    meta: { fetchedAt: "2026-09-01T12:00:00.000Z", fileCount: 3 },
    truncated: false,
    source: "cache",
  },
};
let fileResponse: { status: number; body: unknown } = {
  status: 200,
  body: {
    path: "src/payments/checkout.ts",
    ref: "main",
    sha: "abc",
    content: "line1\nline2\nline3\nline4\nline5\nline6",
    cached: true,
  },
};
let createResponse: { status: number; body: unknown } = {
  status: 201,
  body: { pin: { id: 77, filePath: "src/payments/checkout.ts" } },
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof AddCodePinDialog>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <AddCodePinDialog
        open
        onOpenChange={onOpenChange}
        projectId={7}
        configId={5}
        repositoryId={3}
        caseId={99}
        onCreated={onCreated}
        {...props}
      />
    </QueryClientProvider>
  );
  return { ...utils, onOpenChange, onCreated };
}

function pickFile(path = "src/payments/checkout.ts") {
  act(() => {
    comboboxes[FILE_COMBOBOX].pick({ path, size: 10 });
  });
}

function pickSymbol(name: string) {
  act(() => {
    comboboxes[SYMBOL_COMBOBOX].pick({ name });
  });
}

describe("AddCodePinDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(comboboxes)) delete comboboxes[key];
    filesResponse = {
      status: 200,
      body: {
        files: FILES,
        meta: { fetchedAt: "2026-09-01T12:00:00.000Z", fileCount: 3 },
        truncated: false,
        source: "cache",
      },
    };
    fileResponse = {
      status: 200,
      body: {
        path: "src/payments/checkout.ts",
        ref: "main",
        sha: "abc",
        content: "line1\nline2\nline3\nline4\nline5\nline6",
        cached: true,
      },
    };
    createResponse = {
      status: 201,
      body: { pin: { id: 77, filePath: "src/payments/checkout.ts" } },
    };
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/files?")) {
        return jsonResponse(filesResponse.status, filesResponse.body);
      }
      if (url.includes("/file?")) {
        return jsonResponse(fileResponse.status, fileResponse.body);
      }
      if (url.includes("/code-pins") && init?.method === "POST") {
        return jsonResponse(createResponse.status, createResponse.body);
      }
      if (url.includes("/api/model/RepositoryCases/count")) {
        return jsonResponse(200, { data: 1 });
      }
      if (url.includes("/api/model/RepositoryCases/findMany")) {
        return jsonResponse(200, {
          data: [{ id: 12, name: "Checkout works" }],
        });
      }
      return jsonResponse(404, { error: "Not found" });
    }) as any;
  });

  it("starts in whole-file mode with only the file picker", () => {
    renderDialog();

    expect(screen.getByTestId("code-pin-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("code-pin-file-combobox")).toBeInTheDocument();
    expect(
      screen.queryByTestId("code-pin-case-combobox")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("code-pin-symbol")).not.toBeInTheDocument();
    expect(screen.queryByTestId("code-pin-glob")).not.toBeInTheDocument();
    expect(screen.queryByTestId("code-pin-start-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-pin-note")).toBeInTheDocument();
  });

  it("describes the cached file list under the picker", async () => {
    renderDialog();

    expect(
      await screen.findByTestId("code-pin-files-status")
    ).toHaveTextContent("repository.codePins.filesCached");
  });

  it("explains an empty cache", async () => {
    filesResponse = { status: 409, body: { error: "cache_empty", meta: null } };
    renderDialog();

    expect(
      await screen.findByTestId("code-pin-files-status")
    ).toHaveTextContent("repository.codePins.noFilesCached");
  });

  it("filters the picker over the cached list", async () => {
    renderDialog();
    await screen.findByTestId("code-pin-files-status");

    const result = await comboboxes[FILE_COMBOBOX].fetchOptions(
      "refund",
      0,
      10
    );
    expect(result.total).toBe(1);
    expect(result.results[0].path).toBe("src/payments/refund.ts");
  });

  it("switches the fields with the kind toggle", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("code-pin-kind-SYMBOL"));
    expect(screen.getByTestId("code-pin-symbol")).toBeInTheDocument();
    expect(screen.getByTestId("code-pin-file-combobox")).toBeInTheDocument();
    expect(screen.queryByTestId("code-pin-glob")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("code-pin-kind-GLOB"));
    expect(screen.getByTestId("code-pin-glob")).toBeInTheDocument();
    expect(screen.queryByTestId("code-pin-symbol")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("code-pin-file-combobox")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("code-pin-kind-RANGE"));
    expect(screen.getByTestId("code-pin-file-combobox")).toBeInTheDocument();
    expect(screen.queryByTestId("code-pin-start-line")).not.toBeInTheDocument();
    pickFile();
    expect(screen.getByTestId("code-pin-start-line")).toBeInTheDocument();
    expect(screen.getByTestId("code-pin-end-line")).toBeInTheDocument();
  });

  it("keeps submit disabled until the pin is valid", async () => {
    renderDialog();

    const submit = screen.getByTestId("code-pin-submit");
    expect(submit).toBeDisabled();

    pickFile();
    expect(submit).toBeEnabled();

    fireEvent.click(screen.getByTestId("code-pin-kind-SYMBOL"));
    expect(submit).toBeDisabled();
    pickSymbol("chargeCard");
    expect(submit).toBeEnabled();

    fireEvent.click(screen.getByTestId("code-pin-kind-GLOB"));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("code-pin-glob"), {
      target: { value: "src/payments/**" },
    });
    expect(submit).toBeEnabled();

    fireEvent.click(screen.getByTestId("code-pin-kind-RANGE"));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("code-pin-start-line"), {
      target: { value: "4" },
    });
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByTestId("code-pin-end-line"), {
      target: { value: "2" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("code-pin-end-line"), {
      target: { value: "6" },
    });
    expect(submit).toBeEnabled();
  });

  it("keeps the line inputs and the viewer selection in sync both ways", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("code-pin-kind-RANGE"));
    pickFile();

    const viewer = await screen.findByTestId("code-viewer");
    expect(viewer).toHaveAttribute("data-language", "typescript");
    expect(viewer).toHaveAttribute("data-selection", "null");

    fireEvent.click(screen.getByTestId("code-viewer-pick"));
    expect(screen.getByTestId("code-pin-start-line")).toHaveValue(3);
    expect(screen.getByTestId("code-pin-end-line")).toHaveValue(5);
    expect(screen.getByTestId("code-viewer")).toHaveAttribute(
      "data-selection",
      "[3,5]"
    );

    fireEvent.change(screen.getByTestId("code-pin-start-line"), {
      target: { value: "2" },
    });
    expect(screen.getByTestId("code-viewer")).toHaveAttribute(
      "data-selection",
      "[2,5]"
    );

    fireEvent.change(screen.getByTestId("code-pin-end-line"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("code-viewer")).toHaveAttribute(
      "data-selection",
      "[2,2]"
    );

    fireEvent.click(screen.getByTestId("code-viewer-clear"));
    expect(screen.getByTestId("code-pin-start-line")).toHaveValue(null);
    expect(screen.getByTestId("code-pin-end-line")).toHaveValue(null);
  });

  it("tells the user when the file is too large to display", async () => {
    fileResponse = { status: 413, body: { error: "File too large" } };
    renderDialog();

    fireEvent.click(screen.getByTestId("code-pin-kind-RANGE"));
    pickFile();

    await waitFor(() => {
      expect(screen.getByTestId("code-pin-viewer-status")).toHaveTextContent(
        "repository.codePins.viewerTooLarge"
      );
    });
    expect(screen.queryByTestId("code-viewer")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-pin-start-line")).toBeInTheDocument();
  });

  it("counts the cached files a glob pattern matches", async () => {
    renderDialog();
    await screen.findByTestId("code-pin-files-status");

    fireEvent.click(screen.getByTestId("code-pin-kind-GLOB"));
    fireEvent.change(screen.getByTestId("code-pin-glob"), {
      target: { value: "src/payments/**" },
    });

    expect(screen.getByTestId("code-pin-glob-matches")).toHaveTextContent(
      "repository.codePins.globMatches"
    );
  });

  it("creates the pin, reports it, and closes", async () => {
    const { onCreated, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByTestId("code-pin-kind-RANGE"));
    pickFile();
    await screen.findByTestId("code-viewer");
    fireEvent.click(screen.getByTestId("code-viewer-pick"));
    fireEvent.change(screen.getByTestId("code-pin-note"), {
      target: { value: "Covers checkout" },
    });

    fireEvent.click(screen.getByTestId("code-pin-submit"));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        { id: 77, filePath: "src/payments/checkout.ts" },
        99
      );
    });
    const createCall = (global.fetch as any).mock.calls.find(
      ([url, init]: [string, RequestInit]) =>
        url === "/api/repository-cases/99/code-pins" && init?.method === "POST"
    );
    expect(JSON.parse(createCall[1].body)).toEqual({
      configId: 5,
      kind: "RANGE",
      filePath: "src/payments/checkout.ts",
      startLine: 3,
      endLine: 5,
      note: "Covers checkout",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the duplicate message on a 409", async () => {
    createResponse = {
      status: 409,
      body: { error: "Pin already exists", id: 12 },
    };
    const { onCreated } = renderDialog();

    pickFile();
    fireEvent.click(screen.getByTestId("code-pin-submit"));

    expect(await screen.findByTestId("code-pin-error")).toHaveTextContent(
      "repository.codePins.duplicate"
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  describe("symbol picker", () => {
    const withDeclarations = [
      "export function chargeCard(amount: number) {",
      "  return amount;",
      "}",
      "const helper = () => 1;",
    ].join("\n");

    function openSymbolKind() {
      renderDialog();
      fireEvent.click(screen.getByTestId("code-pin-kind-SYMBOL"));
      pickFile();
    }

    it("offers the declarations found in the chosen file", async () => {
      fileResponse = {
        status: 200,
        body: { path: "a.ts", sha: "abc", content: withDeclarations },
      };
      openSymbolKind();

      await waitFor(() => expect(comboboxes[SYMBOL_COMBOBOX]).toBeDefined());
      await waitFor(async () => {
        const result = await comboboxes[SYMBOL_COMBOBOX].fetchOptions(
          "",
          0,
          30
        );
        expect(result.results.map((option: any) => option.name)).toEqual([
          "chargeCard",
          "helper",
        ]);
      });
    });

    it("offers a typed name the file does not declare", async () => {
      fileResponse = {
        status: 200,
        body: { path: "a.ts", sha: "abc", content: withDeclarations },
      };
      openSymbolKind();

      await waitFor(async () => {
        const result = await comboboxes[SYMBOL_COMBOBOX].fetchOptions(
          "renderRow",
          0,
          30
        );
        expect(result.results[0]).toEqual({ name: "renderRow", typed: true });
      });
    });

    it("filters the list and leaves an exact match unduplicated", async () => {
      fileResponse = {
        status: 200,
        body: { path: "a.ts", sha: "abc", content: withDeclarations },
      };
      openSymbolKind();

      await waitFor(async () => {
        const result = await comboboxes[SYMBOL_COMBOBOX].fetchOptions(
          "chargeCard",
          0,
          30
        );
        expect(result.results).toEqual([{ name: "chargeCard" }]);
      });
    });

    it("says so when the file declares nothing", async () => {
      // The default fixture is six plain lines, so nothing is detected.
      openSymbolKind();

      await waitFor(() =>
        expect(screen.getByTestId("code-pin-symbol-status")).toHaveTextContent(
          "repository.codePins.symbolNoneDetected"
        )
      );
    });

    it("describes how the symbol is located once the list has entries", async () => {
      fileResponse = {
        status: 200,
        body: { path: "a.ts", sha: "abc", content: withDeclarations },
      };
      openSymbolKind();

      await waitFor(() =>
        expect(screen.getByTestId("code-pin-symbol-status")).toHaveTextContent(
          "repository.codePins.symbolHint"
        )
      );
    });
  });

  describe("edit mode", () => {
    const EXISTING = {
      id: 7,
      caseId: 99,
      configId: 5,
      kind: "RANGE" as const,
      filePath: "src/payments/checkout.ts",
      startLine: 30,
      endLine: 64,
      symbol: null,
      note: "old note",
      source: "MANUAL" as const,
      anchorSha: "abc",
      staleDismissedAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      createdBy: { id: "u1", name: "Tester" },
      staleness: null,
    };

    let patched: { url: string; body: any } | null;

    beforeEach(() => {
      patched = null;
      const inner = global.fetch as any;
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/code-pins/") && init?.method === "PATCH") {
          patched = { url, body: JSON.parse(String(init.body)) };
          return jsonResponse(200, { pin: { ...EXISTING, note: "new note" } });
        }
        return inner(url, init);
      }) as any;
    });

    function renderEdit(pin: Record<string, unknown> = {}) {
      return renderDialog({ pin: { ...EXISTING, ...pin } as any });
    }

    it("seeds the fields from the pin and locks its identity", async () => {
      renderEdit();

      expect(screen.getByTestId("code-pin-start-line")).toHaveValue(30);
      expect(screen.getByTestId("code-pin-end-line")).toHaveValue(64);
      expect(screen.getByTestId("code-pin-note")).toHaveValue("old note");
      expect(screen.getByTestId("code-pin-kind-RANGE")).toBeDisabled();
    });

    it("sends only the fields that changed", async () => {
      const { onOpenChange } = renderEdit();

      fireEvent.change(screen.getByTestId("code-pin-end-line"), {
        target: { value: "70" },
      });
      fireEvent.click(screen.getByTestId("code-pin-submit"));

      await waitFor(() => expect(patched).not.toBeNull());
      expect(patched!.url).toContain("/code-pins/7");
      expect(patched!.body).toEqual({ startLine: 30, endLine: 70 });
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it("sends a cleared note as null", async () => {
      renderEdit();

      fireEvent.change(screen.getByTestId("code-pin-note"), {
        target: { value: "" },
      });
      fireEvent.click(screen.getByTestId("code-pin-submit"));

      await waitFor(() => expect(patched).not.toBeNull());
      expect(patched!.body).toEqual({ note: null });
    });

    it("closes without a request when nothing changed", async () => {
      const { onOpenChange } = renderEdit();

      fireEvent.click(screen.getByTestId("code-pin-submit"));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(patched).toBeNull();
    });

    it("reports a rejected edit without closing", async () => {
      global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/code-pins/") && init?.method === "PATCH") {
          return jsonResponse(422, {
            error: "Symbol not found",
            code: "symbol_not_found",
          });
        }
        return jsonResponse(200, { pins: [], stalenessError: null });
      }) as any;
      const { onOpenChange } = renderEdit();

      fireEvent.change(screen.getByTestId("code-pin-note"), {
        target: { value: "different" },
      });
      fireEvent.click(screen.getByTestId("code-pin-submit"));

      expect(await screen.findByTestId("code-pin-error")).toHaveTextContent(
        "repository.codePins.errorSymbolNotFound"
      );
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  it("maps a 422 anchor code to its message", async () => {
    createResponse = {
      status: 422,
      body: { error: "Symbol not found", code: "symbol_not_found" },
    };
    renderDialog();

    fireEvent.click(screen.getByTestId("code-pin-kind-SYMBOL"));
    pickFile();
    pickSymbol("missing");
    fireEvent.click(screen.getByTestId("code-pin-submit"));

    expect(await screen.findByTestId("code-pin-error")).toHaveTextContent(
      "repository.codePins.errorSymbolNotFound"
    );
  });

  describe("case-picking mode", () => {
    it("shows the case picker and requires a case before submitting", async () => {
      const { onCreated } = renderDialog({ caseId: undefined });

      expect(screen.getByTestId("code-pin-case-combobox")).toBeInTheDocument();

      pickFile();
      expect(screen.getByTestId("code-pin-submit")).toBeDisabled();

      act(() => {
        comboboxes[CASE_COMBOBOX].pick({ id: 12, name: "Checkout works" });
      });
      expect(screen.getByTestId("code-pin-submit")).toBeEnabled();

      fireEvent.click(screen.getByTestId("code-pin-submit"));

      await waitFor(() => {
        expect(onCreated).toHaveBeenCalledWith(expect.anything(), 12);
      });
      const createCall = (global.fetch as any).mock.calls.find(
        ([url, init]: [string, RequestInit]) =>
          url === "/api/repository-cases/12/code-pins" &&
          init?.method === "POST"
      );
      expect(createCall).toBeDefined();
    });

    it("searches this project's cases by name", async () => {
      renderDialog({ caseId: undefined });

      const result = await comboboxes[CASE_COMBOBOX].fetchOptions(
        "check",
        0,
        10
      );
      expect(result.results).toEqual([{ id: 12, name: "Checkout works" }]);
      expect(result.total).toBe(1);

      const findManyCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url.includes("/api/model/RepositoryCases/findMany")
      );
      const params = JSON.parse(
        new URL(findManyCall[0], "http://localhost").searchParams.get("q") ??
          "{}"
      );
      expect(params.where).toEqual({
        projectId: 7,
        isDeleted: false,
        name: { contains: "check", mode: "insensitive" },
      });
      expect(params.select).toEqual({ id: true, name: true });
    });
  });

  it("seeds the file and kind from the caller", () => {
    renderDialog({ initialFilePath: "src/app.ts", initialKind: "SYMBOL" });

    expect(screen.getByTestId("code-pin-file-combobox")).toHaveTextContent(
      "src/app.ts"
    );
    expect(screen.getByTestId("code-pin-symbol")).toBeInTheDocument();
  });
});
