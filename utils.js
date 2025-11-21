import { appendFile, writeFile } from 'fs/promises';

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
   */
  constructor(options) {
    this.#retries = options.retries || 0;
    this.#timeout = options.timeout || 10_000;
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
          console.warn(
            `Attempt ${i + 1}/${
              retries + 1
            } failed for "${url}", retrying...`
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
   * @type {number}
   */
  #index;

  /**
   * @param {(() => Promise<T>)[]} promises
   */
  constructor(promises) {
    this.#promises = promises;
    this.#results = [];
    this.#index = 0;
  }

  /**
   * @param {object} options
   * @param {number} options.batchSize
   * @returns {Promise<T[]>}
   */
  async run(options) {
    const size = Math.min(options.batchSize, this.#promises.length);
    const executing = [];

    for (let i = 0; i < size; i++) {
      executing.push(this.#runOne(i));
    }

    await Promise.all(executing);

    return [...this.#results];
  }

  /**
   * @param {number} index
   * @returns {Promise<void>}
   */
  async #runOne(index) {
    const result = await this.#promises[index]();

    this.#results[index] = result;

    if (this.#index < this.#promises.length - 1) {
      this.#index++;

      const nextIndex = this.#index;

      if (nextIndex < this.#promises.length) {
        await this.#runOne(nextIndex);
      }
    }
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
