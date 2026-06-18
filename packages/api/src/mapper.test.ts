import { describe, it, expect } from 'vitest';
import { automationStepsToCaseSteps, deriveCaseStepsIfFresh } from './mapper.js';
import type { AutomationStep } from './types.js';

describe('automationStepsToCaseSteps', () => {
  it('maps a Given/When/Then scenario 1:1 (Given → Step 0, Then → last When expectedResult)', () => {
    const input: AutomationStep[] = [
      { title: 'I am logged in', kind: 'precondition' },
      { title: 'I add an item to the cart', kind: 'action' },
      { title: 'the cart shows 1 item', kind: 'assertion' },
    ];
    expect(automationStepsToCaseSteps(input)).toEqual([
      { step: 'I am logged in', order: 0 },
      { step: 'I add an item to the cart', expectedResult: 'the cart shows 1 item', order: 1 },
    ]);
  });

  it('treats adapter-resolved And/But continuations (kind=action) as their own step rows', () => {
    // And/But keyword inheritance is the adapter's job; the mapper just sees kinds.
    const input: AutomationStep[] = [
      { title: 'I am logged in', kind: 'precondition' },
      { title: 'I add an item to the cart', kind: 'action' },
      { title: 'I proceed to checkout', kind: 'action' }, // And → action
      { title: 'I see the order summary', kind: 'assertion' }, // Then
    ];
    expect(automationStepsToCaseSteps(input)).toEqual([
      { step: 'I am logged in', order: 0 },
      { step: 'I add an item to the cart', order: 1 },
      { step: 'I proceed to checkout', expectedResult: 'I see the order summary', order: 2 },
    ]);
  });

  it('concatenates a contiguous multi-Then group into ONE expectedResult (not new rows)', () => {
    const input: AutomationStep[] = [
      { title: 'I check out', kind: 'action' },
      { title: 'I see the order summary', kind: 'assertion' },
      { title: 'I receive a confirmation email', kind: 'assertion' },
    ];
    const rows = automationStepsToCaseSteps(input);
    expect(rows).toEqual([
      {
        step: 'I check out',
        expectedResult: 'I see the order summary\nI receive a confirmation email',
        order: 0,
      },
    ]);
    // Explicit: the two assertions did NOT become their own rows.
    expect(rows).toHaveLength(1);
  });

  it('leaves a non-last When-group step with an empty (omitted) expectedResult — never invented', () => {
    const input: AutomationStep[] = [
      { title: 'first action', kind: 'action' },
      { title: 'second action', kind: 'action' },
      { title: 'result holds', kind: 'assertion' },
    ];
    const rows = automationStepsToCaseSteps(input);
    expect(rows).toEqual([
      { step: 'first action', order: 0 },
      { step: 'second action', expectedResult: 'result holds', order: 1 },
    ]);
    // The intermediate When-step carries no expectedResult key at all.
    expect(rows[0].expectedResult).toBeUndefined();
  });

  it('attaches a Then with no preceding When onto the last Given/Step-0 row', () => {
    const input: AutomationStep[] = [
      { title: 'the system is seeded', kind: 'precondition' },
      { title: 'the seed data is present', kind: 'assertion' },
    ];
    expect(automationStepsToCaseSteps(input)).toEqual([
      { step: 'the system is seeded', expectedResult: 'the seed data is present', order: 0 },
    ]);
  });

  it('splits a Playwright action with a nested expect child into step + expectedResult (D-09)', () => {
    const input: AutomationStep[] = [
      { title: 'Navigate to product page', kind: 'action' },
      { title: 'Add item to cart', kind: 'action' },
      {
        title: 'Proceed to checkout',
        kind: 'action',
        children: [{ title: 'Order summary is visible', kind: 'assertion' }],
      },
    ];
    expect(automationStepsToCaseSteps(input)).toEqual([
      { step: 'Navigate to product page', order: 0 },
      { step: 'Add item to cart', order: 1 },
      { step: 'Proceed to checkout', expectedResult: 'Order summary is visible', order: 2 },
    ]);
  });

  it('returns [] for empty / low-structure input (D-14)', () => {
    expect(automationStepsToCaseSteps([])).toEqual([]);
  });

  it('handles large flat input in a single linear pass without recursion (DoS bound T-01-01)', () => {
    const input: AutomationStep[] = Array.from({ length: 5000 }, (_, i) => ({
      title: `action ${i}`,
      kind: 'action' as const,
    }));
    const rows = automationStepsToCaseSteps(input);
    expect(rows).toHaveLength(5000);
    expect(rows[0]).toEqual({ step: 'action 0', order: 0 });
    expect(rows[4999]).toEqual({ step: 'action 4999', order: 4999 });
  });
});

describe('deriveCaseStepsIfFresh (CORE-01 never-overwrite guard)', () => {
  const fixture: AutomationStep[] = [
    { title: 'I am logged in', kind: 'precondition' },
    { title: 'I add an item to the cart', kind: 'action' },
    { title: 'the cart shows 1 item', kind: 'assertion' },
  ];

  it('returns [] with no rows when the case already has 1 non-deleted step', () => {
    expect(deriveCaseStepsIfFresh(fixture, 1)).toEqual([]);
  });

  it('returns [] when the case already has several steps', () => {
    expect(deriveCaseStepsIfFresh(fixture, 5)).toEqual([]);
  });

  it('passes the mapped rows through when the case has zero steps', () => {
    expect(deriveCaseStepsIfFresh(fixture, 0)).toEqual(automationStepsToCaseSteps(fixture));
  });
});
