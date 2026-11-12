// The TestPlanIt API key lives in Forge's secret store, which encrypts it at
// rest. It used to be saved as an ordinary key-value entry; `read` moves a key
// found there into the secret store the first time it is read.

export const API_KEY_KEY = 'testplanit_api_key';

export function createApiKeyStore(kvs) {
  return {
    async read() {
      const secret = await kvs.getSecret(API_KEY_KEY);
      if (secret) {
        return secret;
      }

      const legacy = await kvs.get(API_KEY_KEY);
      if (!legacy) {
        return null;
      }

      await kvs.setSecret(API_KEY_KEY, legacy);
      await kvs.delete(API_KEY_KEY);
      return legacy;
    },

    async save(apiKey) {
      await kvs.setSecret(API_KEY_KEY, apiKey);
      await kvs.delete(API_KEY_KEY);
    },

    async clear() {
      await kvs.deleteSecret(API_KEY_KEY);
      await kvs.delete(API_KEY_KEY);
    },
  };
}
