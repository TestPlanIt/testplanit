import { Page } from "@playwright/test";

/**
 * Helper functions for stabilizing E2E tests
 */

/**
 * Fills a TipTap editor with content in a stable way
 */
export async function fillTipTapEditor(
  page: Page,
  content: string,
  editorSelector = '[contenteditable="true"]'
) {
  const editor = page.locator(editorSelector).last();
  await editor.waitFor({ state: "visible", timeout: 5000 });
  await editor.click();
  
  // Clear existing content
  await editor.press("Control+a");
  await editor.press("Delete");
  
  // For short content, type it
  if (content.length < 100) {
    await editor.pressSequentially(content, { delay: 50 });
  } else {
    // For long content, use evaluate for better performance
    await editor.evaluate((el, text) => {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, content);
  }
  
  return editor;
}

/**
 * Waits for a network request to complete
 */
export async function waitForRequest(
  page: Page,
  urlPattern: string | RegExp,
  timeout = 10000
) {
  return page.waitForResponse(
    response => {
      const matches = typeof urlPattern === 'string' 
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url());
      return matches && response.status() === 200;
    },
    { timeout }
  );
}

/**
 * Retries an action until it succeeds or times out
 */
export async function retryAction<T>(
  action: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    timeout?: number;
  } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, timeout = 30000 } = options;
  const startTime = Date.now();
  
  for (let i = 0; i < retries; i++) {
    try {
      return await action();
    } catch (error) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Action timed out after ${timeout}ms: ${error}`);
      }
      
      if (i === retries - 1) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error("Retry action failed");
}

/**
 * Waits for the page to be fully loaded and stable
 */
export async function waitForPageReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
  
  // Wait for any animations to complete
  await page.waitForTimeout(500);
  
  // Ensure no pending requests
  await page.evaluate(() => {
    return new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve(true);
      } else {
        window.addEventListener('load', () => resolve(true));
      }
    });
  });
}

/**
 * Clicks an element with retry logic
 */
export async function clickWithRetry(
  page: Page,
  selector: string,
  options: {
    timeout?: number;
    force?: boolean;
  } = {}
) {
  const element = page.locator(selector);
  await element.waitFor({ state: "visible", timeout: options.timeout || 5000 });
  
  await retryAction(async () => {
    await element.click({ force: options.force });
  });
}

/**
 * Fills an input with verification
 */
export async function fillInputWithVerification(
  page: Page,
  selector: string,
  value: string,
  options: {
    timeout?: number;
  } = {}
) {
  const input = page.locator(selector);
  await input.waitFor({ state: "visible", timeout: options.timeout || 5000 });
  
  await input.fill(value);
  
  // Verify the value was set
  await page.waitForFunction(
    ({ selector, value }) => {
      const element = document.querySelector(selector) as HTMLInputElement;
      return element && element.value === value;
    },
    { selector, value },
    { timeout: options.timeout || 5000 }
  );
}