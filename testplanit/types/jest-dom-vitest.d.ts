import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// Vitest 5 dropped the `jest.Matchers` bridge that jest-dom's own types rely
// on, so the matchers are attached through Vitest's `Matchers` extension point.
declare module "vitest" {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    // Interface merging requires Vitest's exact parameter list, T included.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    T = unknown,
  > extends TestingLibraryMatchers<any, R> {}
}
