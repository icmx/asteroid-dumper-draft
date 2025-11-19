import { appendFile, writeFile } from 'fs/promises';

/**
 * @param {string} name
 * @returns {string}
 */
const env = (name) => {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`"${name}" environment variable is not defined`);
  }

  return value;
};

const CONFIG = (() => {
  const baseUrl = env('AG_BASE_URL'); // e.g.: https://example.org/api
  const apiKey = env('AG_API_KEY');

  const now = Date.now();
  const day = 86400000;

  const yesterdayStamp = new Date(now - day).toJSON().substring(0, 10);
  const todayStamp = new Date(now).toJSON().substring(0, 10);

  const currencies = new Set(
    `
      AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND
      BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE
      CZK DJF DKK DOP DZD EGP ETB EUR FJD GBP GEL GHS GMD GNF GTQ GYD
      HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR
      KMF KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MOP
      MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PEN PGK
      PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SOS
      SRD SZL THB TJS TMT TND TRY TTD TWD TZS UAH UGX USD UYU UZS VES
      VND XAF XCD XOF XPF YER ZAR ZMW
    `
      .trim()
      .split(/\s+/)
  );

  return {
    url: `${baseUrl}/${yesterdayStamp}?access_key=${apiKey}`,
    latestUrl: `${baseUrl}/${todayStamp}?access_key=${apiKey}`,
    retries: 3,
    timeout: 2_000,
    currencies,
    basePath: `./data/v1`,
  };
})();

/**
 * @template T
 * @param {string} url
 * @param {object?} options
 * @param {number?} options.retries
 * @param {number?} options.timeout
 * @returns {Promise<T>}
 */
export const httpGet = async (url, options) => {
  const retries = options?.retries || 0;
  const timeout = options?.timeout || 10_000;

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
            options.retries
          } failed for "${url}", retrying...`
        );
      } else {
        throw error;
      }
    }
  }
};

/**
 * @param {object} data
 * @param {string} data.date
 * @param {Record<string, number>} data.rates
 * @returns {[string, string][]}
 */
export const dataToLines = (data) => {
  const lines = Object.entries(data.rates)
    .filter(([key]) => {
      return CONFIG.currencies.has(key);
    })
    .sort(([prevKey], [nextKey]) => {
      return prevKey.localeCompare(nextKey);
    })
    .map(([key, value]) => {
      return [key, `${data.date},${value || ''}`];
    });

  return lines;
};

/**
 * @param {string} filePath
 * @param {string} line
 * @returns {Promise<void>}
 */
export const writeLine = async (filePath, line) => {
  return writeFile(filePath, `${line}\n`, {
    encoding: 'utf-8',
    flag: 'w',
  });
};

/**
 * @param {string} filePath
 * @param {string} line
 * @returns {Promise<void>}
 */
export const appendLine = (filePath, line) => {
  return appendFile(filePath, `${line}\n`, {
    encoding: 'utf-8',
    flag: 'a',
  });
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
 * @param {string} url
 * @param {object} options
 * @param {(path: string, line: string) => Promise<void>} options.handler
 * @param {(quote: string) => string} options.name
 */
const fetchLines = async (url, options) => {
  const data = await httpGet(url, {
    retries: CONFIG.retries,
    timeout: CONFIG.timeout,
  });

  const lines = dataToLines(data);

  const tasks = lines.map(([quote, line]) => {
    const path = options.name(quote);

    return () =>
      options.handler(`${CONFIG.basePath}/EUR/${path}`, line);
  });

  await new Concurrency(tasks).run({ batchSize: 100 });
};

/**
 * @returns {Promise<void>}
 */
export const main = async () => {
  await fetchLines(CONFIG.url, {
    handler: appendLine,
    name: (quote) => `${quote}.csv`,
  });

  await fetchLines(CONFIG.latestUrl, {
    handler: writeLine,
    name: (quote) => `${quote}.latest.csv`,
  });
};

main();
