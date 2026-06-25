import axios from "axios";

const responseCache = new Map();
const inFlightRequests = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15 * 1000;

function getCacheKey(url, params) {
  return `${url}?${new URLSearchParams(params || {}).toString()}`;
}

export async function getCached(
  url,
  {
    force = false,
    headers,
    params,
    timeout = DEFAULT_TIMEOUT_MS,
    ttl = DEFAULT_TTL_MS,
  } = {},
) {
  const cacheKey = getCacheKey(url, params);
  const cachedEntry = responseCache.get(cacheKey);

  if (!force && cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.response;
  }

  if (!force && inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const request = axios
    .get(url, { headers, params, timeout })
    .then((response) => {
      responseCache.set(cacheKey, {
        expiresAt: Date.now() + ttl,
        response,
      });
      return response;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, request);
  return request;
}

export function prefetch(url, options) {
  return getCached(url, options).catch(() => null);
}

export function invalidateApiCache(urlPrefix) {
  for (const cacheKey of responseCache.keys()) {
    if (!urlPrefix || cacheKey.startsWith(urlPrefix)) {
      responseCache.delete(cacheKey);
    }
  }
}

export function clearApiCache() {
  responseCache.clear();
  inFlightRequests.clear();
}
