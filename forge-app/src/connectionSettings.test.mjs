import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apiKeyToTest,
  publicSettings,
  typedApiKey,
} from './connectionSettings.js';

describe('publicSettings', () => {
  it('reports that a key is saved without including it', () => {
    const settings = publicSettings({
      instanceUrl: 'https://acme.testplanit.com',
      apiKey: 'tpi_secret',
    });

    assert.deepEqual(settings, {
      instanceUrl: 'https://acme.testplanit.com',
      hasApiKey: true,
    });
    assert.equal(JSON.stringify(settings).includes('tpi_secret'), false);
  });

  it('reports no key and an empty URL when nothing is saved', () => {
    assert.deepEqual(publicSettings({ instanceUrl: null, apiKey: null }), {
      instanceUrl: '',
      hasApiKey: false,
    });
  });
});

describe('typedApiKey', () => {
  it('returns a typed key without surrounding spaces', () => {
    assert.equal(typedApiKey('  tpi_new '), 'tpi_new');
  });

  it('treats a blank or missing field as no key typed', () => {
    for (const value of ['', '   ', undefined, null, 42]) {
      assert.equal(typedApiKey(value), null);
    }
  });
});

describe('apiKeyToTest', () => {
  it('tests the key just typed, even when another is saved', () => {
    assert.equal(apiKeyToTest('tpi_new', 'tpi_saved'), 'tpi_new');
  });

  it('tests the saved key when the field is blank', () => {
    assert.equal(apiKeyToTest('', 'tpi_saved'), 'tpi_saved');
    assert.equal(apiKeyToTest(undefined, 'tpi_saved'), 'tpi_saved');
  });

  it('has nothing to test when the field is blank and no key is saved', () => {
    assert.equal(apiKeyToTest('  ', null), null);
  });
});
