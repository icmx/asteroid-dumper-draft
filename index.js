import {
  appendLine,
  env,
  Fetcher,
  HttpClient,
  writeLine,
} from './utils.js';

const CONFIG = (() => {
  const quotes = `
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
    .split(/\s+/);

  const baseUrl = env('AG_BASE_URL'); // e.g.: https://example.org/api
  const apiKey = env('AG_API_KEY');

  const yesterday = new Date(Date.now() - 86400000)
    .toJSON()
    .substring(0, 10);

  return {
    retries: 3,
    timeout: 2_000,
    backoff: 3_000,
    quotes,
    url: `${baseUrl}/${yesterday}?access_key=${apiKey}`,
    latestUrl: `${baseUrl}/latest?access_key=${apiKey}`,
    basePath: `./data/v1`,
  };
})();

export const main = async () => {
  const httpClient = new HttpClient({
    retries: CONFIG.retries,
    timeout: CONFIG.timeout,
    backoff: CONFIG.backoff,
  });

  const fetcher = new Fetcher({
    httpClient,
    quotes: CONFIG.quotes,
  });

  await fetcher.run(CONFIG.url, {
    path: (quote) => `${CONFIG.basePath}/EUR/${quote}.csv`,
    handler: appendLine,
  });

  await fetcher.run(CONFIG.latestUrl, {
    path: (quote) => `${CONFIG.basePath}/EUR/${quote}.latest.csv`,
    handler: writeLine,
  });
};

main();
