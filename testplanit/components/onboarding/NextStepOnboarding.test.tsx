import { fireEvent, render, screen } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useFindFirstUserPreferences,
  useFindManyProjects,
  useUpdateUserPreferences,
} from "~/lib/hooks";

// vi.hoisted() for stable refs in vi.mock() factories
const {
  mockStartNextStep,
  mockCloseNextStep,
  mockSetCurrentStep,
  mockUpdatePreferencesMutateAsync,
  mockNextStepCardComponent,
} = vi.hoisted(() => ({
  mockStartNextStep: vi.fn(),
  mockCloseNextStep: vi.fn(),
  mockSetCurrentStep: vi.fn(),
  mockUpdatePreferencesMutateAsync: vi.fn().mockResolvedValue({}),
  mockNextStepCardComponent: { current: null as any },
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key.split(".").pop() ?? key),
}));

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "123" })),
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
    toString: vi.fn(() => ""),
  })),
}));

vi.mock("~/lib/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: vi.fn(() => ({
    permissions: null,
  })),
}));

vi.mock("~/lib/hooks", () => ({
  useFindFirstUserPreferences: vi.fn(),
  useFindManyProjects: vi.fn(),
  useUpdateUserPreferences: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  ApplicationArea: {
    REPOSITORY: "REPOSITORY",
    TEST_RUNS: "TEST_RUNS",
    SESSIONS: "SESSIONS",
    ADMIN: "ADMIN",
    SharedSteps: "SharedSteps",
    Reporting: "Reporting",
    Settings: "Settings",
  },
}));

// Mock nextstepjs — capture cardComponent for TourCard testing
vi.mock("nextstepjs", () => ({
  NextStepProvider: ({ children }: any) => (
    <div data-testid="nextstep-provider">{children}</div>
  ),
  NextStep: ({ cardComponent, children }: any) => {
    mockNextStepCardComponent.current = cardComponent;
    return <div data-testid="nextstep">{children}</div>;
  },
  useNextStep: vi.fn(() => ({
    startNextStep: mockStartNextStep,
    closeNextStep: mockCloseNextStep,
    setCurrentStep: mockSetCurrentStep,
    currentTour: null,
    currentStep: 0,
    isNextStepVisible: false,
  })),
  NavigationAdapter: ({ children }: any) => (
    <div data-testid="navigation-adapter">{children}</div>
  ),
}));


import { NextStepOnboarding } from "./NextStepOnboarding";

const mockUseFindFirstUserPreferences = vi.mocked(useFindFirstUserPreferences);
const mockUseFindManyProjects = vi.mocked(useFindManyProjects);
const mockUseUpdateUserPreferences = vi.mocked(useUpdateUserPreferences);
const mockUseSession = vi.mocked(useSession);

const setupDefaultMocks = () => {
  mockUseSession.mockReturnValue({
    data: { user: { id: "user-1" } },
    status: "authenticated",
    update: vi.fn(),
  } as any);

  mockUseFindFirstUserPreferences.mockReturnValue({
    data: {
      id: "pref-1",
      hasCompletedWelcomeTour: false,
    },
    isLoading: false,
  } as any);

  mockUseFindManyProjects.mockReturnValue({
    data: [{ id: 1, name: "My Project" }],
    isLoading: false,
  } as any);

  mockUseUpdateUserPreferences.mockReturnValue({
    mutateAsync: mockUpdatePreferencesMutateAsync,
  } as any);
};

describe("NextStepOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNextStepCardComponent.current = null;
    mockUpdatePreferencesMutateAsync.mockResolvedValue({});
    setupDefaultMocks();
  });

  it("renders without crashing when session exists", () => {
    const { container } = render(<NextStepOnboarding><div /></NextStepOnboarding>);
    expect(container).toBeDefined();
  });

  it("renders NextStepProvider", () => {
    render(<NextStepOnboarding><div /></NextStepOnboarding>);
    expect(screen.getByTestId("nextstep-provider")).toBeInTheDocument();
  });

  it("renders when preferences data is loading", () => {
    mockUseFindFirstUserPreferences.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);
    render(<NextStepOnboarding><div /></NextStepOnboarding>);
    expect(screen.getByTestId("nextstep-provider")).toBeInTheDocument();
  });

  it("renders when user has not completed welcome tour", () => {
    mockUseFindFirstUserPreferences.mockReturnValue({
      data: { id: "pref-1", hasCompletedWelcomeTour: false },
      isLoading: false,
    } as any);
    render(<NextStepOnboarding><div /></NextStepOnboarding>);
    expect(screen.getByTestId("nextstep-provider")).toBeInTheDocument();
  });

  it("renders when user has already completed welcome tour", () => {
    mockUseFindFirstUserPreferences.mockReturnValue({
      data: { id: "pref-1", hasCompletedWelcomeTour: true },
      isLoading: false,
    } as any);
    render(<NextStepOnboarding><div /></NextStepOnboarding>);
    expect(screen.getByTestId("nextstep-provider")).toBeInTheDocument();
  });

  it("passes cardComponent prop to NextStep", () => {
    render(<NextStepOnboarding><div /></NextStepOnboarding>);
    expect(mockNextStepCardComponent.current).toBeDefined();
    expect(typeof mockNextStepCardComponent.current).toBe("function");
  });
});

describe("TourCard (via NextStepOnboarding cardComponent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNextStepCardComponent.current = null;
    mockUpdatePreferencesMutateAsync.mockResolvedValue({});
    setupDefaultMocks();
  });

  const renderAndGetTourCard = () => {
    render(<NextStepOnboarding><div /></NextStepOnboarding>);
    return mockNextStepCardComponent.current;
  };

  it("TourCard renders step title", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    render(
      <TourCard
        step={{ title: "Welcome to TestPlanIt", content: "Let us show you around." }}
        currentStep={0}
        totalSteps={5}
        nextStep={vi.fn()}
        prevStep={vi.fn()}
        skipTour={vi.fn()}
      />
    );

    expect(screen.getByText("Welcome to TestPlanIt")).toBeInTheDocument();
  });

  it("TourCard renders step content", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    render(
      <TourCard
        step={{ title: "Step Title", content: "Step description text" }}
        currentStep={0}
        totalSteps={3}
        nextStep={vi.fn()}
        prevStep={vi.fn()}
        skipTour={vi.fn()}
      />
    );

    expect(screen.getByText("Step description text")).toBeInTheDocument();
  });

  it("TourCard shows skip button and calls skipTour when clicked", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    const mockSkipTour = vi.fn();
    render(
      <TourCard
        step={{ title: "Step", content: "Content" }}
        currentStep={0}
        totalSteps={3}
        nextStep={vi.fn()}
        prevStep={vi.fn()}
        skipTour={mockSkipTour}
      />
    );

    // Skip button has sr-only text from translation (key: common.ui.onboarding.skipTour -> "skipTour")
    const skipButton = screen.getByRole("button", { name: /skipTour/i });
    fireEvent.click(skipButton);
    expect(mockSkipTour).toHaveBeenCalledTimes(1);
  });

  it("TourCard Next button calls nextStep", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    const mockNextStep = vi.fn();
    render(
      <TourCard
        step={{ title: "Step", content: "Content" }}
        currentStep={0}
        totalSteps={3}
        nextStep={mockNextStep}
        prevStep={vi.fn()}
        skipTour={vi.fn()}
      />
    );

    // "next" from translation mock (key: common.actions.next -> "next")
    const nextButton = screen.getByText("next");
    fireEvent.click(nextButton);
    expect(mockNextStep).toHaveBeenCalledTimes(1);
  });

  it("TourCard shows 'finish' on last step instead of next", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    render(
      <TourCard
        step={{ title: "Final Step", content: "You're done!" }}
        currentStep={2}
        totalSteps={3}
        nextStep={vi.fn()}
        prevStep={vi.fn()}
        skipTour={vi.fn()}
      />
    );

    expect(screen.getByText("finish")).toBeInTheDocument();
    expect(screen.queryByText("next")).not.toBeInTheDocument();
  });

  it("TourCard does NOT show Previous button on first step", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    render(
      <TourCard
        step={{ title: "First Step", content: "Content" }}
        currentStep={0}
        totalSteps={3}
        nextStep={vi.fn()}
        prevStep={vi.fn()}
        skipTour={vi.fn()}
      />
    );

    expect(screen.queryByText("previous")).not.toBeInTheDocument();
  });

  it("TourCard shows Previous button and calls prevStep on steps after first", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    const mockPrevStep = vi.fn();
    render(
      <TourCard
        step={{ title: "Step 2", content: "Content" }}
        currentStep={1}
        totalSteps={3}
        nextStep={vi.fn()}
        prevStep={mockPrevStep}
        skipTour={vi.fn()}
      />
    );

    const prevButton = screen.getByText("previous");
    expect(prevButton).toBeInTheDocument();
    fireEvent.click(prevButton);
    expect(mockPrevStep).toHaveBeenCalledTimes(1);
  });

  it("TourCard shows step progress indicator", () => {
    const TourCard = renderAndGetTourCard();
    if (!TourCard) return;

    render(
      <TourCard
        step={{ title: "Step", content: "Content" }}
        currentStep={1}
        totalSteps={5}
        nextStep={vi.fn()}
        prevStep={vi.fn()}
        skipTour={vi.fn()}
      />
    );

    // Progress indicator: "2 / 5" (currentStep + 1)
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });
});
