import { getProvider } from '../api';

// The appointments page needs each provider's name and timezone. Several appointments often
// share one provider, so remember lookups for a short while instead of asking again.
const TTL_MS = 30_000;
const cache = new Map();

export function fetchProvider(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = getProvider(id).catch((error) => {
    cache.delete(id);
    throw error;
  });
  cache.set(id, { at: Date.now(), promise });
  return promise;
}

export function clearProviderCache() {
  cache.clear();
}
