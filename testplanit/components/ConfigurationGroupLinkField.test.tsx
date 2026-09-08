import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const translate = (key: string, values?: Record<string, unknown>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const map: Record<string, string> = {
        "common.configurationGroup.title": "Configuration Group",
        "common.configurationGroup.notLinkedRun":
          "Not linked to any other test run.",
        "common.configurationGroup.notLinkedSession":
          "Not linked to any other session.",
        "common.configurationGroup.linkRun": "Link to a test run",
        "common.configurationGroup.linkSession": "Link to a session",
        "common.configurationGroup.changeRun": "Link to a different test run",
        "common.configurationGroup.changeSession":
          "Link to a different session",
        "common.configurationGroup.unlink": "Unlink",
        "common.configurationGroup.pending": "Not saved yet",
        "common.labels.noConfiguration": "No configuration",
      };
      if (fullKey === "common.labels.configurationWithName") {
        return `${values?.configuration} — ${values?.name}`;
      }
      return map[fullKey] ?? key.split(".").pop() ?? key;
    };
    return translate;
  },
  useLocale: () => "en-US",
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const mockRunFindMany = vi.fn();
const mockSessionFindMany = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    testRuns: { useFindMany: (...args: any[]) => mockRunFindMany(...args) },
    sessions: { useFindMany: (...args: any[]) => mockSessionFindMany(...args) },
  }),
}));

// A stand-in combobox: exposes the fetcher and lets a test pick any candidate.
let capturedFetchOptions:
  ((q: string, p: number, s: number) => Promise<any>) | null = null;
let capturedPick: ((option: any) => void) | null = null;
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ fetchOptions, onValueChange, renderTrigger }: any) => {
    capturedFetchOptions = fetchOptions;
    capturedPick = onValueChange;
    return renderTrigger({ defaultContent: null });
  },
}));

import { ConfigurationGroupLinkField } from "./ConfigurationGroupLinkField";

const GROUP_A = "11111111-1111-4111-8111-111111111111";
const GROUP_B = "22222222-2222-4222-8222-222222222222";

const peerRow = (id: number, name: string, configuration?: string) => ({
  id,
  name,
  configuration: configuration ? { id: id * 10, name: configuration } : null,
});

const renderField = (
  props: Partial<React.ComponentProps<typeof ConfigurationGroupLinkField>> = {}
) => {
  const onChange = vi.fn();
  const result = render(
    <ConfigurationGroupLinkField
      model="testRuns"
      recordId={1}
      projectId={7}
      value={null}
      savedValue={null}
      onChange={onChange}
      editable
      {...props}
    />
  );
  return { onChange, ...result };
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedFetchOptions = null;
  capturedPick = null;
  mockRunFindMany.mockReturnValue({ data: [] });
  mockSessionFindMany.mockReturnValue({ data: [] });
  global.fetch = vi.fn(
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  ) as unknown as typeof fetch;
});

describe("ConfigurationGroupLinkField state", () => {
  it("renders the unlinked state when the record has no group", () => {
    renderField();

    expect(screen.getByTestId("configuration-group-empty")).toHaveTextContent(
      "Not linked to any other test run."
    );
    expect(
      screen.queryByTestId("configuration-group-unlink")
    ).not.toBeInTheDocument();
  });

  it("lists the other members, labelled by configuration, when linked", () => {
    mockRunFindMany.mockReturnValue({
      data: [
        peerRow(1, "Run A", "Chrome"),
        peerRow(2, "Run B", "Firefox"),
        peerRow(3, "Run C", "Safari"),
      ],
    });
    renderField({ value: GROUP_A, savedValue: GROUP_A });

    // The record itself is never listed as its own peer.
    expect(
      screen.queryByTestId("configuration-group-member-1")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("configuration-group-member-2")
    ).toHaveTextContent("Run B");
    expect(
      screen.getByTestId("configuration-group-member-3")
    ).toHaveTextContent("Safari");
    expect(
      screen.queryByTestId("configuration-group-empty")
    ).not.toBeInTheDocument();
  });

  it("disambiguates members that share one configuration", () => {
    mockRunFindMany.mockReturnValue({
      data: [
        peerRow(1, "Run A", "Chrome"),
        peerRow(2, "Run B", "Firefox"),
        peerRow(3, "Run C", "Firefox"),
      ],
    });
    renderField({ value: GROUP_A, savedValue: GROUP_A });

    expect(
      screen.getByTestId("configuration-group-member-2")
    ).toHaveTextContent("Firefox — Run B");
    expect(
      screen.getByTestId("configuration-group-member-3")
    ).toHaveTextContent("Firefox — Run C");
  });

  it("hides the controls but keeps the state visible when not editable", () => {
    mockRunFindMany.mockReturnValue({
      data: [peerRow(1, "Run A"), peerRow(2, "Run B", "Chrome")],
    });
    renderField({ value: GROUP_A, savedValue: GROUP_A, editable: false });

    expect(screen.getByTestId("configuration-group-member-2")).toBeVisible();
    expect(
      screen.queryByTestId("configuration-group-link-picker")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("configuration-group-unlink")
    ).not.toBeInTheDocument();
  });

  it("shows saved membership, not a staged one, when not editable", () => {
    // A staged pick that was never saved must not read as real membership:
    // the "not saved yet" notice only renders in the editable branch, so a
    // read-only panel showing `value` would assert a link with no warning.
    mockRunFindMany.mockReturnValue({ data: [] });
    renderField({ value: GROUP_B, savedValue: null, editable: false });

    expect(mockRunFindMany).toHaveBeenCalled();
    const [args, options] = mockRunFindMany.mock.calls[0];
    // The saved value is null, so the query has no group to scope to and is
    // disabled rather than fetching the staged group's members.
    expect(args.where.configurationGroupId).toBeUndefined();
    expect(options.enabled).toBe(false);
    expect(screen.getByTestId("configuration-group-empty")).toBeVisible();
  });

  it("still shows the staged group while editable", () => {
    mockRunFindMany.mockReturnValue({ data: [] });
    renderField({ value: GROUP_B, savedValue: null, editable: true });

    const [args] = mockRunFindMany.mock.calls[0];
    expect(args.where).toEqual(
      expect.objectContaining({ configurationGroupId: GROUP_B })
    );
  });
});

describe("ConfigurationGroupLinkField linking", () => {
  it("mints one group for both records when the peer has no group", () => {
    const { onChange } = renderField();

    act(() => {
      capturedPick!({
        id: 9,
        name: "Run Z",
        projectId: 7,
        configurationGroupId: null,
        configuration: null,
      });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0][0];
    expect(change.groupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    // The peer has to be stamped too, or this record sits alone in the group.
    expect(change.stampTargetId).toBe(9);
  });

  it("adopts the peer's existing group without stamping the peer", () => {
    const { onChange } = renderField();

    act(() => {
      capturedPick!({
        id: 9,
        name: "Run Z",
        projectId: 7,
        configurationGroupId: GROUP_B,
        configuration: null,
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      groupId: GROUP_B,
      stampTargetId: null,
    });
  });

  it("ignores a peer that is already in this record's group", () => {
    const { onChange } = renderField({ value: GROUP_A, savedValue: GROUP_A });

    act(() => {
      capturedPick!({
        id: 9,
        name: "Run Z",
        projectId: 7,
        configurationGroupId: GROUP_A,
        configuration: null,
      });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("excludes this record and the current members from the candidates", async () => {
    mockRunFindMany.mockReturnValue({
      data: [peerRow(1, "Run A"), peerRow(2, "Run B")],
    });
    renderField({ value: GROUP_A, savedValue: GROUP_A });

    await capturedFetchOptions!("", 0, 10);

    const url = (global.fetch as any).mock.calls[0][0] as string;
    const query = JSON.parse(decodeURIComponent(url.split("?q=")[1] as string));
    expect(url).toContain("/api/model/TestRuns/findMany");
    expect(query.where.id.notIn).toEqual([1, 2]);
    expect(query.where.projectId).toBe(7);
    expect(query.where.isDeleted).toBe(false);
  });

  it("queries the session model for sessions", async () => {
    renderField({ model: "sessions" });

    await capturedFetchOptions!("", 0, 10);

    expect((global.fetch as any).mock.calls[0][0]).toContain(
      "/api/model/Sessions/findMany"
    );
  });

  it("flags a pick that has not been saved yet", () => {
    renderField({ value: GROUP_B, savedValue: GROUP_A });

    expect(screen.getByTestId("configuration-group-pending")).toBeVisible();
  });
});

describe("ConfigurationGroupLinkField unlinking", () => {
  it("clears the group id", () => {
    mockRunFindMany.mockReturnValue({
      data: [peerRow(1, "Run A"), peerRow(2, "Run B"), peerRow(3, "Run C")],
    });
    const { onChange } = renderField({ value: GROUP_A, savedValue: GROUP_A });

    fireEvent.click(screen.getByTestId("configuration-group-unlink"));

    expect(onChange).toHaveBeenCalledWith({
      groupId: null,
      stampTargetId: null,
    });
  });
});
