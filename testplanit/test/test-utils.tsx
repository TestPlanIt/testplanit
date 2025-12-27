import React, { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";

// Note: next-intl is mocked globally in vitest.setup.tsx
// This wrapper provides any additional providers needed for tests
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  // Add other global providers here if needed (Theme, State Management, etc.)
  return <>{children}</>;
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything from testing-library
export * from "@testing-library/react";

// Override render method
export { customRender as render };
