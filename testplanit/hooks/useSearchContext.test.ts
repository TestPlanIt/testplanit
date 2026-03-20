import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableEntityType } from "~/types/search";
import {
  getEntityIcon,
  getEntityLabel,
  useSearchContext,
  useSearchScope,
} from "./useSearchContext";

// --- Mocks ---

const { mockPathname, mockParams, mockSession } = vi.hoisted(() => ({
  mockPathname: vi.fn(() => "/en-US/projects/"),
  mockParams: vi.fn(() => ({})),
  mockSession: vi.fn((): any => ({ data: null, status: "unauthenticated" })),
}));

vi.mock("~/lib/navigation", () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => mockParams(),
  usePathname: () => mockPathname(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockSession(),
}));

// --- Helpers ---

const authedSession = {
  data: { user: { id: "user-1", name: "Alice", access: "MEMBER" } },
  status: "authenticated",
};

const noAccessSession = {
  data: { user: { id: "user-2", name: "Bob", access: "NONE" } },
  status: "authenticated",
};

describe("useSearchContext", () => {
  it("returns global search context when not on a project path", () => {
    mockPathname.mockReturnValue("/en-US/dashboard");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.isGlobalSearch).toBe(true);
    expect(result.current.currentEntity).toBeNull();
    expect(result.current.projectId).toBeNull();
  });

  it("returns empty availableEntities when user has no session", () => {
    mockPathname.mockReturnValue("/en-US/dashboard");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue({ data: null, status: "unauthenticated" });

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.availableEntities).toEqual([]);
  });

  it("returns all entity types for authenticated user with access", () => {
    mockPathname.mockReturnValue("/en-US/dashboard");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.availableEntities).toContain(SearchableEntityType.PROJECT);
    expect(result.current.availableEntities).toContain(SearchableEntityType.REPOSITORY_CASE);
    expect(result.current.availableEntities).toContain(SearchableEntityType.TEST_RUN);
    expect(result.current.availableEntities).toContain(SearchableEntityType.SESSION);
    expect(result.current.availableEntities).toContain(SearchableEntityType.ISSUE);
    expect(result.current.availableEntities).toContain(SearchableEntityType.MILESTONE);
  });

  it("returns empty availableEntities for user with NONE access", () => {
    mockPathname.mockReturnValue("/en-US/dashboard");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue(noAccessSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.availableEntities).toEqual([]);
  });

  it("returns REPOSITORY_CASE context on repository path", () => {
    mockPathname.mockReturnValue("/en-US/projects/repository/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.REPOSITORY_CASE);
    expect(result.current.projectId).toBe(42);
    expect(result.current.isGlobalSearch).toBe(false);
    expect(result.current.defaultFilters.entityTypes).toContain(
      SearchableEntityType.REPOSITORY_CASE
    );
    expect(result.current.defaultFilters.repositoryCase?.projectIds).toContain(42);
  });

  it("returns TEST_RUN context on runs path", () => {
    mockPathname.mockReturnValue("/en-US/projects/runs/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.TEST_RUN);
    expect(result.current.projectId).toBe(42);
    expect(result.current.defaultFilters.entityTypes).toContain(SearchableEntityType.TEST_RUN);
  });

  it("returns SESSION context on sessions path", () => {
    mockPathname.mockReturnValue("/en-US/projects/sessions/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.SESSION);
    expect(result.current.projectId).toBe(42);
  });

  it("returns ISSUE context on issues path", () => {
    mockPathname.mockReturnValue("/en-US/projects/issues/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.ISSUE);
    expect(result.current.projectId).toBe(42);
  });

  it("returns MILESTONE context on milestones path", () => {
    mockPathname.mockReturnValue("/en-US/projects/milestones/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.MILESTONE);
    expect(result.current.projectId).toBe(42);
  });

  it("returns SHARED_STEP context on shared-steps path", () => {
    mockPathname.mockReturnValue("/en-US/projects/shared-steps/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.SHARED_STEP);
    expect(result.current.projectId).toBe(42);
  });

  it("returns PROJECT context on the /projects/ listing page (with trailing slash)", () => {
    // NOTE: The source code has a structural quirk: the /projects path check is inside
    // the startsWith("/projects/") block, so it only matches when path is /projects/ (trailing slash)
    // The path /projects (no slash) hits the global search guard first.
    mockPathname.mockReturnValue("/en-US/projects/");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.PROJECT);
    expect(result.current.projectId).toBeNull();
    expect(result.current.availableEntities).toEqual([SearchableEntityType.PROJECT]);
  });

  it("returns project overview context with all entity filters when on a project overview page", () => {
    mockPathname.mockReturnValue("/en-US/projects/42/overview");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBeNull();
    expect(result.current.projectId).toBe(42);
    expect(result.current.isGlobalSearch).toBe(false);
    // All entity filters include the projectId
    expect(result.current.defaultFilters.repositoryCase?.projectIds).toContain(42);
    expect(result.current.defaultFilters.testRun?.projectIds).toContain(42);
    expect(result.current.defaultFilters.session?.projectIds).toContain(42);
  });

  it("strips locale prefix (xx-XX format) from pathname correctly", () => {
    mockPathname.mockReturnValue("/fr-FR/projects/repository/5");
    mockParams.mockReturnValue({ projectId: "5" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.REPOSITORY_CASE);
    expect(result.current.projectId).toBe(5);
  });

  it("strips short locale prefix (xx format) from pathname correctly", () => {
    mockPathname.mockReturnValue("/en/projects/runs/7");
    mockParams.mockReturnValue({ projectId: "7" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchContext());

    expect(result.current.currentEntity).toBe(SearchableEntityType.TEST_RUN);
    expect(result.current.projectId).toBe(7);
  });
});

describe("getEntityLabel", () => {
  it("returns human-readable labels for all entity types", () => {
    expect(getEntityLabel(SearchableEntityType.REPOSITORY_CASE)).toBe("Repository Cases");
    expect(getEntityLabel(SearchableEntityType.TEST_RUN)).toBe("Test Runs");
    expect(getEntityLabel(SearchableEntityType.SESSION)).toBe("Sessions");
    expect(getEntityLabel(SearchableEntityType.PROJECT)).toBe("Projects");
    expect(getEntityLabel(SearchableEntityType.ISSUE)).toBe("Issues");
    expect(getEntityLabel(SearchableEntityType.MILESTONE)).toBe("Milestones");
    expect(getEntityLabel(SearchableEntityType.SHARED_STEP)).toBe("Shared Steps");
  });

  it("returns the entity type as fallback for unknown types", () => {
    const unknown = "UNKNOWN_TYPE" as SearchableEntityType;
    expect(getEntityLabel(unknown)).toBe("UNKNOWN_TYPE");
  });
});

describe("getEntityIcon", () => {
  it("returns icon names for all entity types", () => {
    expect(getEntityIcon(SearchableEntityType.REPOSITORY_CASE)).toBe("list-checks");
    expect(getEntityIcon(SearchableEntityType.TEST_RUN)).toBe("play-circle");
    expect(getEntityIcon(SearchableEntityType.SESSION)).toBe("compass");
    expect(getEntityIcon(SearchableEntityType.PROJECT)).toBe("boxes");
    expect(getEntityIcon(SearchableEntityType.ISSUE)).toBe("bug");
    expect(getEntityIcon(SearchableEntityType.MILESTONE)).toBe("milestone");
    expect(getEntityIcon(SearchableEntityType.SHARED_STEP)).toBe("layers");
  });

  it("returns 'file' as fallback for unknown types", () => {
    const unknown = "UNKNOWN_TYPE" as SearchableEntityType;
    expect(getEntityIcon(unknown)).toBe("file");
  });
});

describe("useSearchScope", () => {
  it("includes 'All Projects' scope always", () => {
    mockPathname.mockReturnValue("/en-US/dashboard");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchScope());

    const allScope = result.current.find((s) => s.value === "all");
    expect(allScope).toBeDefined();
    expect(allScope?.label).toBe("All Projects");
  });

  it("includes 'Current Project' scope when inside a project", () => {
    mockPathname.mockReturnValue("/en-US/projects/42/overview");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchScope());

    const projectScope = result.current.find((s) => s.value === "project");
    expect(projectScope).toBeDefined();
    expect(projectScope?.projectId).toBe(42);
  });

  it("includes 'Current' entity scope when on an entity-specific page", () => {
    mockPathname.mockReturnValue("/en-US/projects/repository/42");
    mockParams.mockReturnValue({ projectId: "42" });
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchScope());

    const currentScope = result.current.find((s) => s.value === "current");
    expect(currentScope).toBeDefined();
    expect(currentScope?.entityTypes).toContain(SearchableEntityType.REPOSITORY_CASE);
  });

  it("only includes 'All Projects' scope on non-project pages", () => {
    mockPathname.mockReturnValue("/en-US/dashboard");
    mockParams.mockReturnValue({});
    mockSession.mockReturnValue(authedSession);

    const { result } = renderHook(() => useSearchScope());

    expect(result.current).toHaveLength(1);
    expect(result.current[0].value).toBe("all");
  });
});
