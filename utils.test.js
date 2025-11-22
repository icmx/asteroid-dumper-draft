import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendLine,
  Concurrency,
  dataToLines,
  env,
  Fetcher,
  HttpClient,
  wait,
  writeLine,
} from './utils.js';

describe('env function', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('when environment variable exists', () => {
    it('should return the value of an existing environment variable', () => {
      process.env.TEST_VAR = 'test_value';

      const result = env('TEST_VAR');

      assert.equal(result, 'test_value');
    });
  });

  describe('when environment variable does not exist', () => {
    it('should throw an error for undefined environment variable', () => {
      assert.throws(
        () => env('NON_EXISTENT_VAR'),
        new Error(
          '"NON_EXISTENT_VAR" environment variable is not defined'
        )
      );
    });
  });

  describe('edge cases', () => {
    it('should throw an error for empty string values', () => {
      process.env.EMPTY_VAR = '';

      assert.throws(
        () => env('EMPTY_VAR'),
        new Error('"EMPTY_VAR" environment variable is not defined')
      );
    });

    it('should return "false" string value', () => {
      process.env.BOOL_VAR = 'false';

      const result = env('BOOL_VAR');

      assert.equal(result, 'false');
    });

    it('should return "0" string value', () => {
      process.env.ZERO_VAR = '0';

      const result = env('ZERO_VAR');

      assert.equal(result, '0');
    });
  });
});

describe('wait function', () => {
  let startTime;

  beforeEach(() => {
    startTime = Date.now();
  });

  it('should return a Promise', () => {
    const result = wait(100);

    assert(result instanceof Promise, 'wait should return a Promise');
  });

  it('should resolve after the specified delay', async () => {
    const delay = 100;
    const tolerance = 50;

    const start = Date.now();
    await wait(delay);
    const elapsed = Date.now() - start;

    assert(
      elapsed >= delay,
      `Should wait at least ${delay}ms, but only waited ${elapsed}ms`
    );

    assert(
      elapsed < delay + tolerance,
      `Should wait close to ${delay}ms, but waited ${elapsed}ms`
    );
  });

  it('should work with async/await in sequence', async () => {
    const delay1 = 50;
    const delay2 = 50;
    const tolerance = 50;

    const start = Date.now();
    await wait(delay1);
    await wait(delay2);
    const elapsed = Date.now() - start;

    const totalDelay = delay1 + delay2;

    assert(
      elapsed >= totalDelay,
      `Sequential waits should take at least ${totalDelay}ms`
    );

    assert(
      elapsed < totalDelay + tolerance,
      `Should complete close to ${totalDelay}ms`
    );
  });
});

describe('HttpClient', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = mock.fn(global.fetch);
    global.fetch = fetchMock;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('get', () => {
    it('should successfully fetch and parse JSON', async () => {
      const mockData = { test: 'data' };
      const mockResponse = {
        ok: true,
        json: mock.fn(() => Promise.resolve(mockData)),
      };

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(mockResponse)
      );

      const client = new HttpClient();
      const result = await client.get('http://example.org');

      assert.deepEqual(result, mockData);
      assert.equal(fetchMock.mock.calls.length, 1);
      assert.equal(
        fetchMock.mock.calls[0].arguments[0],
        'http://example.org'
      );
    });

    it('should throw error on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(mockResponse)
      );

      const client = new HttpClient();

      await assert.rejects(
        client.get('http://example.org'),
        new Error('HTTP 404: Not Found on "http://example.org"')
      );
    });

    it('should retry on failure', async () => {
      const mockData = { test: 'data' };
      let attemptCount = 0;

      fetchMock.mock.mockImplementation(() => {
        attemptCount++;

        if (attemptCount < 3) {
          return Promise.reject(new Error('Network error'));
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockData),
        });
      });

      const warnMock = mock.fn();
      const originalWarn = console.warn;
      console.warn = warnMock;

      const client = new HttpClient({ retries: 2 });
      const result = await client.get('http://example.org');

      console.warn = originalWarn;

      assert.deepEqual(result, mockData);
      assert.equal(fetchMock.mock.calls.length, 3);
      assert.equal(warnMock.mock.calls.length, 2);
    });

    it('should throw after all retries exhausted', async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.reject(new Error('Network error'))
      );

      const warnMock = mock.fn();
      const originalWarn = console.warn;
      console.warn = warnMock;

      const client = new HttpClient({ retries: 1 });

      await assert.rejects(
        client.get('http://example.org'),
        new Error('Network error')
      );

      console.warn = originalWarn;

      assert.equal(fetchMock.mock.calls.length, 2); // 1 initial + 1 retry
    });

    it('should respect timeout', async () => {
      fetchMock.mock.mockImplementation((url, options) => {
        assert.ok(options.signal instanceof AbortSignal);

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const client = new HttpClient({ timeout: 5000 });
      await client.get('http://test.com');

      assert.equal(fetchMock.mock.calls.length, 1);
    });
  });
});

describe('dataToLines', () => {
  it('should filter and sort rates correctly', () => {
    const data = {
      date: '2024-01-01',
      rates: {
        USD: 1.0,
        EUR: 0.85,
        GBP: 0.73,
        JPY: 110.5,
      },
    };

    const result = dataToLines(data, {
      quotes: ['EUR', 'USD'],
    });

    assert.deepEqual(result, [
      ['EUR', '2024-01-01,0.85'],
      ['USD', '2024-01-01,1'],
    ]);
  });

  it('should handle empty rates', () => {
    const data = {
      date: '2024-01-01',
      rates: {
        USD: null,
        EUR: undefined,
      },
    };

    const result = dataToLines(data, {
      quotes: ['EUR', 'USD'],
    });

    assert.deepEqual(result, [
      ['EUR', '2024-01-01,'],
      ['USD', '2024-01-01,'],
    ]);
  });

  it('should return empty array when no quotes match', () => {
    const data = {
      date: '2024-01-01',
      rates: {
        USD: 1.0,
        EUR: 0.85,
      },
    };

    const result = dataToLines(data, {
      quotes: ['GBP', 'JPY'],
    });

    assert.deepEqual(result, []);
  });
});

describe('Concurrency', () => {
  it('should execute all promises and return results in order', async () => {
    const promises = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const concurrency = new Concurrency(promises);
    const results = await concurrency.run({ batchSize: 2 });

    assert.deepEqual(results, [1, 2, 3]);
  });

  it('should handle batch size larger than promises array', async () => {
    const promises = [
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
    ];

    const concurrency = new Concurrency(promises);
    const results = await concurrency.run({ batchSize: 10 });

    assert.deepEqual(results, ['a', 'b']);
  });

  it('should handle single promise', async () => {
    const promises = [() => Promise.resolve('single')];

    const concurrency = new Concurrency(promises);
    const results = await concurrency.run({ batchSize: 1 });

    assert.deepEqual(results, ['single']);
  });

  it('should limit concurrent executions', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const promises = Array(10)
      .fill(null)
      .map((_, i) => async () => {
        concurrent++;

        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));

        concurrent--;

        return i;
      });

    const concurrency = new Concurrency(promises);
    await concurrency.run({ batchSize: 3 });

    assert.ok(
      maxConcurrent <= 3,
      `Max concurrent was ${maxConcurrent}, expected <= 3`
    );
  });

  it('should handle promise rejections', async () => {
    const promises = [
      () => Promise.resolve(1),
      () => Promise.reject(new Error('Failed')),
      () => Promise.resolve(3),
    ];

    const concurrency = new Concurrency(promises);

    await assert.rejects(
      concurrency.run({ batchSize: 2 }),
      new Error('Failed')
    );
  });
});

describe('writeLine', () => {
  let tempFile;

  beforeEach(() => {
    tempFile = join(
      tmpdir(),
      `temp-${Date.now()}-${Math.random()}.csv`
    );
  });

  afterEach(async () => {
    try {
      await rm(tempFile, { force: true });
    } catch {}
  });

  it('should write line with newline to file', async () => {
    await writeLine(tempFile, 'test line');

    const content = await readFile(tempFile, 'utf-8');
    assert.equal(content, 'test line\n');
  });

  it('should overwrite existing file', async () => {
    await writeLine(tempFile, 'first line');
    await writeLine(tempFile, 'second line');

    const content = await readFile(tempFile, 'utf-8');
    assert.equal(content, 'second line\n');
  });
});

describe('appendLine', () => {
  let tempFile;

  beforeEach(() => {
    tempFile = join(
      tmpdir(),
      `temp-${Date.now()}-${Math.random()}.csv`
    );
  });

  afterEach(async () => {
    try {
      await rm(tempFile, { force: true });
    } catch {}
  });

  it('should append line with newline to file', async () => {
    await writeLine(tempFile, 'first line');
    await appendLine(tempFile, 'second line');

    const content = await readFile(tempFile, 'utf-8');
    assert.equal(content, 'first line\nsecond line\n');
  });

  it('should create file if it does not exist', async () => {
    await appendLine(tempFile, 'test line');

    const content = await readFile(tempFile, 'utf-8');
    assert.equal(content, 'test line\n');
  });
});

describe('Fetcher', () => {
  let httpClient;
  let fetcher;

  beforeEach(() => {
    httpClient = {
      get: mock.fn(),
    };
  });

  it('should fetch data and process lines', async () => {
    const mockData = {
      date: '2024-01-01',
      rates: {
        USD: 1.2,
        EUR: 0.85,
      },
    };

    httpClient.get.mock.mockImplementation(() =>
      Promise.resolve(mockData)
    );

    const handlerMock = mock.fn(() => Promise.resolve());
    const pathMock = mock.fn((quote) => `/path/${quote}.txt`);

    fetcher = new Fetcher({
      httpClient,
      quotes: ['USD', 'EUR'],
    });

    await fetcher.run('http://example.org', {
      path: pathMock,
      handler: handlerMock,
    });

    assert.equal(httpClient.get.mock.calls.length, 1);

    assert.equal(
      httpClient.get.mock.calls[0].arguments[0],
      'http://example.org'
    );

    assert.equal(pathMock.mock.calls.length, 2);
    assert.equal(handlerMock.mock.calls.length, 2);

    const calls = handlerMock.mock.calls.map((call) => call.arguments);

    assert.deepEqual(calls[0], ['/path/EUR.txt', '2024-01-01,0.85']);
    assert.deepEqual(calls[1], ['/path/USD.txt', '2024-01-01,1.2']);
  });

  it('should handle empty quotes', async () => {
    const mockData = {
      date: '2024-01-01',
      rates: {
        USD: 1.0,
        EUR: 0.85,
      },
    };

    httpClient.get.mock.mockImplementation(() =>
      Promise.resolve(mockData)
    );

    const handlerMock = mock.fn(() => Promise.resolve());
    const pathMock = mock.fn();

    fetcher = new Fetcher({
      httpClient,
      quotes: [],
    });

    await fetcher.run('http://example.org', {
      path: pathMock,
      handler: handlerMock,
    });

    assert.equal(handlerMock.mock.calls.length, 0);
    assert.equal(pathMock.mock.calls.length, 0);
  });

  it('should propagate httpClient errors', async () => {
    httpClient.get.mock.mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    );

    fetcher = new Fetcher({
      httpClient,
      quotes: ['USD'],
    });

    await assert.rejects(
      fetcher.run('http://test.com', {
        path: () => '/path',
        handler: () => Promise.resolve(),
      }),
      new Error('Network error')
    );
  });
});
