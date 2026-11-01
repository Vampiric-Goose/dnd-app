import { expect, test } from 'vitest';
import { parseRelay, storedRelay } from '../../src/lib/sync/relay.ts';

test('parseRelay takes turn/turns URLs with credentials and says what is wrong otherwise', () => {
  expect(parseRelay('turn:a.example.com:80, turns:a.example.com:443?transport=tcp', ' u ', ' p ')).toEqual({
    urls: ['turn:a.example.com:80', 'turns:a.example.com:443?transport=tcp'], username: 'u', credential: 'p' });
  expect(parseRelay('', 'u', 'p')).toMatch(/at least one/);
  expect(parseRelay('stun:a.example.com', 'u', 'p')).toMatch(/turn: or turns:/);
  expect(parseRelay('turn:a.example.com', '', 'p')).toMatch(/username and password/);
});

test('storedRelay rejects damaged values', () => {
  expect(storedRelay({ urls: ['turn:a.example.com'], username: 'u', credential: 'p' })?.urls).toEqual(['turn:a.example.com']);
  expect(storedRelay({ urls: 'turn:a', username: 'u', credential: 'p' })).toBeUndefined();
  expect(storedRelay(null)).toBeUndefined();
});
