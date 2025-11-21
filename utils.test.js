import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from './utils.js';

describe('Tests', () => {
  it('should start', () => {
    const httpClient = new HttpClient({ retries: 0, timeout: 0 });

    assert.ok(httpClient instanceof HttpClient);
  });
});
