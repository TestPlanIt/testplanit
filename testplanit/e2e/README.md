# E2E Test Stability Guide

This guide provides best practices for writing stable E2E tests in our Playwright test suite.

## Authentication

**Important**: Authentication is handled automatically by `global.setup.ts`, which logs in as an admin user and saves the authentication state. This means:

- **DO NOT** log in manually in your tests unless you need to test with a different user
- All tests run with admin privileges by default (user: `admin@testplanit.com`)
- The authentication state is stored and reused across all tests for performance

### Testing with Different Users

If you need to test with a non-admin user:
1. First, sign out from the admin session
2. Then log in as the specific user
3. Remember to handle the sign-out process properly

```typescript
// Example: Testing access control
await page.goto("/api/auth/signout");
await page.locator('button:has-text("Sign out")').click();

const signInPage = new SignInPage(page);
await signInPage.goto();
await signInPage.login(users.regular.email, users.regular.password);
```

## Common Issues and Solutions

### 1. Timing Issues
**Problem**: Tests fail intermittently due to elements not being ready.

**Solutions**:
- Always wait for elements to be visible before interacting
- Use `waitForLoadState('networkidle')` after navigation
- Add explicit waits for dynamic content
- Use `test.step()` to organize test flow

```typescript
// Bad
await page.click('button');

// Good
const button = page.locator('button');
await button.waitFor({ state: 'visible', timeout: 5000 });
await button.click();
```

### 2. Network Requests
**Problem**: Tests fail when API calls take longer than expected.

**Solutions**:
- Wait for specific network requests to complete
- Use longer timeouts for operations that involve API calls
- Use `waitForResponse()` to ensure data is loaded

```typescript
// Wait for API response
const responsePromise = page.waitForResponse('/api/notifications');
await page.click('button[type="submit"]');
await responsePromise;
```

### 3. Dynamic Content
**Problem**: Content updates dynamically causing selectors to fail.

**Solutions**:
- Use stable selectors (data-testid, aria-labels)
- Wait for content to stabilize before assertions
- Use `filter()` for dynamic lists

```typescript
// Good - using filter for dynamic content
const row = page.locator('tr').filter({ hasText: dynamicTitle });
await expect(row).toBeVisible({ timeout: 10000 });
```

### 4. Form Interactions
**Problem**: Form inputs don't register values correctly.

**Solutions**:
- Clear fields before typing
- Use `pressSequentially()` with delay for better stability (note: `type()` is deprecated)
- Verify values after filling

```typescript
// Good form interaction
const input = page.locator('input[name="title"]');
await input.fill(''); // Clear first
await input.fill('My Title'); // For regular inputs

// For contenteditable elements or when you need typing delay
const editor = page.locator('[contenteditable="true"]');
await editor.pressSequentially('My content', { delay: 50 });
await expect(editor).toContainText('My content');
```

### 5. TipTap Editor
**Problem**: Rich text editors are complex and timing-sensitive.

**Solutions**:
- Clear content before typing
- Use delays between formatting operations
- Use helper functions for complex operations

```typescript
// Use the helper function
import { fillTipTapEditor } from './helpers/test-utils';
await fillTipTapEditor(page, 'My content');
```

## Best Practices

### 1. Use Test Steps
Organize tests into logical steps for better debugging:

```typescript
await test.step('Login as admin', async () => {
  // login logic
});

await test.step('Create notification', async () => {
  // creation logic
});
```

### 2. Set Appropriate Timeouts
- Page navigation: 30 seconds
- Element visibility: 5-10 seconds
- API responses: 15 seconds
- Assertions: 5-10 seconds

### 3. Handle Animations
Wait for animations to complete:

```typescript
await page.waitForTimeout(500); // After major UI changes
```

### 4. Use Retry Logic
For critical operations, implement retry:

```typescript
import { retryAction } from './helpers/test-utils';

await retryAction(async () => {
  await page.click('button');
  await expect(page.locator('.success')).toBeVisible();
});
```

### 5. Clean Test Data
Use unique identifiers to avoid conflicts:

```typescript
const title = `Test ${Date.now()}`;
```

## Debugging Failed Tests

1. **Check screenshots/videos**: Playwright captures these on failure
2. **Run tests locally**: `pnpm test:e2e -- --ui`
3. **Use trace viewer**: `npx playwright show-report`
4. **Add console logs**: `page.on('console', msg => console.log(msg.text()))`
5. **Slow down execution**: `--slow-mo=1000` flag

## Configuration Tips

In `playwright.config.ts`:
- Set `retries: 2` for CI environments
- Use `trace: 'on-first-retry'` for debugging
- Enable `video: 'on'` to capture test runs
- Set appropriate `timeout` values

## Test IDs Strategy

### Why Use Test IDs?

Test IDs (`data-testid` attributes) provide the most stable selectors for E2E tests because:
- They don't change when text content is updated
- They're not affected by styling changes
- They're language-agnostic (work across all locales)
- They're explicit markers for testing

### Adding Test IDs

When writing components, add test IDs to key interactive elements:

```tsx
// Example: Admin notifications page
<CardTitle data-testid="system-notifications-section">
  {t("systemNotification.title")}
</CardTitle>

<Input
  id="system-notification-title"
  data-testid="notification-title-input"
  value={systemNotificationTitle}
  onChange={(e) => setSystemNotificationTitle(e.target.value)}
/>

<Button
  onClick={handleSendSystemNotification}
  data-testid="send-notification-button"
>
  {t("systemNotification.send")}
</Button>
```

### Using Test IDs in Tests

```typescript
// Instead of text-based selectors that might change:
// await page.getByText("System Notifications").click();

// Use test IDs for stability:
await page.locator('[data-testid="system-notifications-section"]').click();

// Playwright also provides a convenience method:
await page.getByTestId('notification-title-input').fill('My Title');
```

### Test ID Naming Convention

Follow these naming patterns:
- **Sections**: `[feature]-section` (e.g., `system-notifications-section`)
- **Inputs**: `[field]-input` (e.g., `notification-title-input`)
- **Buttons**: `[action]-button` (e.g., `send-notification-button`)
- **Tables**: `[content]-table` (e.g., `notification-history-table`)
- **Titles**: `[page/section]-title` (e.g., `notifications-page-title`)

### When to Add Test IDs

Add test IDs when:
- Creating new features with E2E tests
- Fixing flaky tests that rely on text selectors
- Building critical user paths
- Working with dynamic content

## Common Selectors

Prefer these selector strategies in order:
1. `data-testid` attributes (most stable)
2. ARIA labels and roles
3. Text content (for user-visible elements)
4. CSS selectors (as last resort)

```typescript
// Best to worst
await page.getByTestId('submit-button').click();
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByText('Submit').click();
await page.locator('button.submit-btn').click();
```