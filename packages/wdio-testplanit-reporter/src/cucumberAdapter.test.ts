import { describe, it, expect } from 'vitest';

import { adaptCucumberStepTitles } from './cucumberAdapter.js';

describe('adaptCucumberStepTitles', () => {
  it('maps Given/When/Then to precondition/action/assertion with keyword stripped', () => {
    expect(
      adaptCucumberStepTitles([
        'Given I am on the homepage',
        'When I enter valid credentials',
        'Then I should see the dashboard',
      ]),
    ).toEqual([
      { title: 'I am on the homepage', kind: 'precondition' },
      { title: 'I enter valid credentials', kind: 'action' },
      { title: 'I should see the dashboard', kind: 'assertion' },
    ]);
  });

  it('inherits the prior primary kind for And (after When → action)', () => {
    expect(
      adaptCucumberStepTitles(['When I enter credentials', 'And I click submit']),
    ).toEqual([
      { title: 'I enter credentials', kind: 'action' },
      { title: 'I click submit', kind: 'action' },
    ]);
  });

  it('inherits the prior primary kind for But (after Then → assertion)', () => {
    expect(
      adaptCucumberStepTitles(['Then I see a success message', 'But I am not logged out']),
    ).toEqual([
      { title: 'I see a success message', kind: 'assertion' },
      { title: 'I am not logged out', kind: 'assertion' },
    ]);
  });

  it('inherits the prior primary kind for the * bullet keyword', () => {
    expect(adaptCucumberStepTitles(['Given a precondition', '* another precondition'])).toEqual([
      { title: 'a precondition', kind: 'precondition' },
      { title: 'another precondition', kind: 'precondition' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(adaptCucumberStepTitles([])).toEqual([]);
  });

  it('keeps the full title and defaults to action for an unrecognized keyword', () => {
    expect(adaptCucumberStepTitles(['Background setup'])).toEqual([
      { title: 'Background setup', kind: 'action' },
    ]);
  });

  it('maps a full ordered scenario (Given/When/When/Then/And) with correct kinds', () => {
    expect(
      adaptCucumberStepTitles([
        'Given I am logged in',
        'When I add an item to the cart',
        'When I proceed to checkout',
        'Then I see the order summary',
        'And I receive a confirmation email',
      ]),
    ).toEqual([
      { title: 'I am logged in', kind: 'precondition' },
      { title: 'I add an item to the cart', kind: 'action' },
      { title: 'I proceed to checkout', kind: 'action' },
      { title: 'I see the order summary', kind: 'assertion' },
      { title: 'I receive a confirmation email', kind: 'assertion' },
    ]);
  });
});
