import { expect, test } from 'vitest';
import { newKey, publicText, sign, verify } from '../../src/lib/sync/signing.ts';

// A publisher's books win over the DM's copy only with a valid signature from a trusted key, over exactly that JSON and time.
test('a signature checks out against the trusted key, and only for that JSON and time', async () => {
  const k = await newKey(), other = await newKey();
  const trusted = [await publicText(k.publicKey)];
  const sig = await sign(k.privateKey, 1000, '{"id":"xge"}');
  expect(await verify(trusted, 1000, '{"id":"xge"}', sig)).toBe(true);
  expect(await verify(trusted, 1001, '{"id":"xge"}', sig)).toBe(false);
  expect(await verify(trusted, 1000, '{"id":"xgf"}', sig)).toBe(false);
  expect(await verify([await publicText(other.publicKey)], 1000, '{"id":"xge"}', sig)).toBe(false);
  expect(await verify(['not a key'], 1000, '{"id":"xge"}', sig)).toBe(false);
  expect(await verify(trusted, 1000, '{"id":"xge"}', 'garbage')).toBe(false);
});

test('the private half cannot be read out of the browser', async () => {
  const k = await newKey();
  await expect(crypto.subtle.exportKey('pkcs8', k.privateKey)).rejects.toThrow();
});
