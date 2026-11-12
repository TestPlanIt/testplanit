import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { API_KEY_KEY, createApiKeyStore } from './apiKeyStore.js';

function fakeKvs({ plain = {}, secret = {} } = {}) {
  const state = { plain: { ...plain }, secret: { ...secret } };
  return {
    state,
    get: async (key) => state.plain[key],
    set: async (key, value) => {
      state.plain[key] = value;
    },
    delete: async (key) => {
      delete state.plain[key];
    },
    getSecret: async (key) => state.secret[key],
    setSecret: async (key, value) => {
      state.secret[key] = value;
    },
    deleteSecret: async (key) => {
      delete state.secret[key];
    },
  };
}

describe('API key store', () => {
  let kvs;

  beforeEach(() => {
    kvs = fakeKvs();
  });

  it('returns null when no key has been saved', async () => {
    assert.equal(await createApiKeyStore(kvs).read(), null);
    assert.deepEqual(kvs.state, { plain: {}, secret: {} });
  });

  it('saves the key as a secret and never as a plain entry', async () => {
    await createApiKeyStore(kvs).save('tpi_new');

    assert.deepEqual(kvs.state.secret, { [API_KEY_KEY]: 'tpi_new' });
    assert.deepEqual(kvs.state.plain, {});
  });

  it('reads back a saved key', async () => {
    const store = createApiKeyStore(kvs);
    await store.save('tpi_new');

    assert.equal(await store.read(), 'tpi_new');
  });

  it('moves a key saved by an earlier version into the secret store on first read', async () => {
    kvs = fakeKvs({ plain: { [API_KEY_KEY]: 'tpi_old', other: 'kept' } });

    assert.equal(await createApiKeyStore(kvs).read(), 'tpi_old');

    assert.deepEqual(kvs.state.secret, { [API_KEY_KEY]: 'tpi_old' });
    assert.deepEqual(kvs.state.plain, { other: 'kept' });
  });

  it('keeps returning the key after it has been moved', async () => {
    kvs = fakeKvs({ plain: { [API_KEY_KEY]: 'tpi_old' } });
    const store = createApiKeyStore(kvs);
    await store.read();

    assert.equal(await store.read(), 'tpi_old');
  });

  it('prefers the secret when both copies exist', async () => {
    kvs = fakeKvs({
      plain: { [API_KEY_KEY]: 'tpi_stale' },
      secret: { [API_KEY_KEY]: 'tpi_current' },
    });

    assert.equal(await createApiKeyStore(kvs).read(), 'tpi_current');
  });

  it('removes a leftover plain copy when a new key is saved', async () => {
    kvs = fakeKvs({ plain: { [API_KEY_KEY]: 'tpi_old' } });

    await createApiKeyStore(kvs).save('tpi_new');

    assert.deepEqual(kvs.state.plain, {});
    assert.deepEqual(kvs.state.secret, { [API_KEY_KEY]: 'tpi_new' });
  });

  it('clears both the secret and any plain copy', async () => {
    kvs = fakeKvs({
      plain: { [API_KEY_KEY]: 'tpi_old' },
      secret: { [API_KEY_KEY]: 'tpi_current' },
    });
    const store = createApiKeyStore(kvs);

    await store.clear();

    assert.deepEqual(kvs.state, { plain: {}, secret: {} });
    assert.equal(await store.read(), null);
  });
});
