import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed, originOf } from './origins.js';

test('Link: solo orígenes autorizados, tomados del sender', () => {
  const list = ['https://mesa.example'];
  assert.equal(allowed(originOf({ url: 'https://mesa.example/?code=ABC' }), list), true);
  assert.equal(allowed(originOf({ url: 'https://malo.example/' }), list), false);
  assert.equal(allowed(originOf({ url: 'https://mesa.example.malo.example/' }), list), false);
  assert.equal(allowed(originOf({ url: 'about:blank' }), list), false);
  assert.equal(allowed(originOf({}), ['']), false);
});
