import { appendFile, writeFile } from 'fs/promises';

/**
 * @param {string} name
 * @returns {string}
 */
export const env = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`"${name}" environment variable is not defined`);
  }

  return value;
};

/**
 * @param {number} delay
 * @returns {Promise<void>}
 */
export const wait = (delay) => {
  return new Promise((resolve) => {
    return setTimeout(resolve, delay);
  });
};

export class HttpClient {
  /**
   * @type {number}
   */
  #retries;

  /**
   * @type {number}
   */
  #timeout;

  /**
   * @param {object} options
   * @param {number=} options.retries
   * @param {number=} options.timeout
   * @param {number=} options.backoff
   */
  constructor(options = {}) {
    this.#retries = options.retries || 0;
    this.#timeout = options.timeout || 10_000;
    this.#timeout = options.backoff || 3_000;
  }

  /**
   * @template T
   *
   * @param {string} url
   * @returns {Promise<T>}
   */
  async get(url) {
    const retries = this.#retries;
    const timeout = this.#timeout;

    for (let i = 0; i < retries + 1; i++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${response.statusText} on "${url}"`
          );
        }

        const data = await response.json();

        return data;
      } catch (error) {
        if (i < retries) {
          const attempt = i + 1;

          console.warn(
            `Attempt ${attempt}/${retries} failed for "${url}", retrying...`
          );
        } else {
          throw error;
        }
      }
    }
  }
}

/**
 * @param {object} data
 * @param {string} data.date
 * @param {Record<string, number>} data.rates
 * @param {object} options
 * @param {string[]} options.quotes
 * @returns {[string, string][]}
 */
export const dataToLines = (data, options) => {
  const lines = Object.entries(data.rates)
    .filter(([quote]) => {
      return options.quotes.includes(quote);
    })
    .sort(([prevQuote], [nextQuote]) => {
      return prevQuote.localeCompare(nextQuote);
    })
    .map(([quote, rate]) => {
      return [quote, `${data.date},${rate || ''}`];
    });

  return lines;
};

/**
 * @template T
 */
export class Concurrency {
  /**
   * @type {(() => Promise<T>)[]}
   */
  #promises;

  /**
   * @type {T[]}
   */
  #results;

  /**
   * @param {(() => Promise<T>)[]} promises
   */
  constructor(promises) {
    this.#promises = promises;
    this.#results = new Array(promises.length);
  }

  /**
   * @param {object} options
   * @param {number} options.batchSize
   * @returns {Promise<void>}
   */
  async run(options) {
    const { batchSize } = options;
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < this.#promises.length) {
        const index = currentIndex++;

        if (index < this.#promises.length) {
          this.#results[index] = await this.#promises[index]();
        }
      }
    };

    const workers = Array(Math.min(batchSize, this.#promises.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);
    return this.#results;
  }
}

/**
 * @param {string} path
 * @param {string} line
 * @returns {Promise<void>}
 */
export const writeLine = async (path, line) => {
  return writeFile(path, `${line}\n`, {
    encoding: 'utf-8',
    flag: 'w',
  });
};

/**
 * @param {string} path
 * @param {string} line
 * @returns {Promise<void>}
 */
export const appendLine = (path, line) => {
  return appendFile(path, `${line}\n`, {
    encoding: 'utf-8',
    flag: 'a',
  });
};

export class Fetcher {
  /**
   * @type {HttpClient}
   */
  #httpClient;

  /**
   * @type {string[]}
   */
  #quotes;

  /**
   * @param {object} options
   * @param {HttpClient} options.httpClient
   * @param {string[]} options.quotes
   */
  constructor(options) {
    this.#httpClient = options.httpClient;
    this.#quotes = options.quotes;
  }

  /**
   * @param {string} url
   * @param {object} options
   * @param {(quote: string) => string} options.path
   * @param {(path: string, line: string) => Promise<void>} options.handler
   *
   */
  async run(url, options) {
    const data = await this.#httpClient.get(url);
    const lines = dataToLines(data, { quotes: this.#quotes });

    const tasks = lines.map(([quote, line]) => {
      const path = options.path(quote);

      return () => {
        return options.handler(path, line);
      };
    });

    await new Concurrency(tasks).run({ batchSize: 4 });
  }
}
