import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
} from "@playwright/test";

/**
 * Makes the suite runnable against an install served under a path prefix.
 *
 * Playwright resolves a root-relative path against the ORIGIN of `baseURL`,
 * not its path, so `page.goto("/en-US/signin")` with a baseURL of
 * `http://localhost:3002/testplanit` lands on the host root. With
 * E2E_BASE_PATH set, the fixtures in ./index.ts route every page and API
 * request context through the patches below, which prefix root-relative
 * string URLs once. Absolute URLs, including the `${baseURL}/...` style, pass
 * through untouched. Unset (the normal run), every function here is a no-op
 * and nothing is patched.
 */
export const E2E_BASE_PATH = process.env.E2E_BASE_PATH ?? "";

export function withE2EBasePath(url: string): string {
  if (!E2E_BASE_PATH) return url;
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  if (url === E2E_BASE_PATH || url.startsWith(`${E2E_BASE_PATH}/`)) return url;
  return `${E2E_BASE_PATH}${url}`;
}

const PATCHED = Symbol("e2e-base-path-patched");

function once<T extends object>(target: T): boolean {
  const t = target as T & { [PATCHED]?: true };
  if (t[PATCHED]) return false;
  t[PATCHED] = true;
  return true;
}

export function patchPage(page: Page): Page {
  if (!E2E_BASE_PATH || !once(page)) return page;
  const goto = page.goto.bind(page);
  page.goto = ((url: string, options?: Parameters<Page["goto"]>[1]) =>
    goto(withE2EBasePath(url), options)) as Page["goto"];
  patchRequestContext(page.request);
  return page;
}

const REQUEST_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "fetch",
] as const;

export function patchRequestContext(
  request: APIRequestContext
): APIRequestContext {
  if (!E2E_BASE_PATH || !once(request)) return request;
  for (const method of REQUEST_METHODS) {
    const original = (
      request[method] as (...args: unknown[]) => Promise<unknown>
    ).bind(request);
    (request as unknown as Record<string, unknown>)[method] = (
      url: unknown,
      ...rest: unknown[]
    ) =>
      original(typeof url === "string" ? withE2EBasePath(url) : url, ...rest);
  }
  return request;
}

export function patchContext(context: BrowserContext): BrowserContext {
  if (!E2E_BASE_PATH || !once(context)) return context;
  for (const page of context.pages()) patchPage(page);
  const newPage = context.newPage.bind(context);
  context.newPage = (async () =>
    patchPage(await newPage())) as BrowserContext["newPage"];
  patchRequestContext(context.request);
  return context;
}

export function patchBrowser(browser: Browser): Browser {
  if (!E2E_BASE_PATH || !once(browser)) return browser;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (async (
    options?: Parameters<Browser["newContext"]>[0]
  ) => patchContext(await newContext(options))) as Browser["newContext"];
  return browser;
}
