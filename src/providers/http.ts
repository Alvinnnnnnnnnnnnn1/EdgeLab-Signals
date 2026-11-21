import { hash, nowISO, type Receipt } from '../core/domain';
import type { Config } from '../core/config';
import { Store } from '../core/store';
export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export class ProviderError extends Error { constructor(public provider: string, public kind: string, public status: number | null = null) { super(`${provider}: ${kind}${status ? ` (${status})` : ''}`); } }
const origins = { balldontlie: 'https://api.balldontlie.io', odds: 'https://api.the-odds-api.com' };
export class JsonHTTP {
  constructor(private store: Store, private config: Config, private fetcher: Fetcher = fetch, private clock = nowISO) {}
  async get(provider: keyof Config['providers'], path: string, query: Record<string, string | string[]>, ttlSeconds: number, credits: number, fresh = false): Promise<{ body: unknown; receipt: Receipt; cached: boolean }> {
    if (!path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('#')) throw new Error('Invalid provider path');
    const at = this.clock(), endpoint = new URL(path, origins[provider]);
    for (const [k, v] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) for (const value of Array.isArray(v) ? v : [v]) endpoint.searchParams.append(k, value);
    const cacheKey = hash([provider, endpoint.toString()]);
    if (!fresh) { const cache = this.store.cacheGet(cacheKey, at); if (cache) return { ...cache, cached: true }; }
    if (!this.config.networkEnabled) throw new ProviderError(provider, 'network_disabled');
    const secret = provider === 'odds' ? process.env.ODDS_API_KEY : process.env.BALLDONTLIE_API_KEY;
    if (!secret) throw new ProviderError(provider, 'credential_missing');
    const reservation = this.store.reserve(provider, this.config.providers[provider], credits, at);
    const safeEndpoint = endpoint.toString();
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'EdgeLab-Signals/1.0 (private-research)' };
    if (provider === 'odds') endpoint.searchParams.set('apiKey', secret); else headers.Authorization = secret;
    try {
      const res = await this.fetcher(endpoint, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      const finishedAt = this.clock();
      const remaining = res.headers.get('x-requests-remaining');
      if (remaining !== null && Number.isFinite(Number(remaining))) this.store.set(`quota:${provider}`, { remaining: Number(remaining), used: res.headers.get('x-requests-used'), last: res.headers.get('x-requests-last'), at: finishedAt });
      this.store.set(`provider:${provider}`, { at: finishedAt, status: res.status, state: res.ok ? 'reachable' : 'error' });
      if (!res.ok) { this.store.finishReservation(reservation, `http_${res.status}`); throw new ProviderError(provider, res.status === 401 || res.status === 403 ? 'entitlement_or_credentials_denied' : res.status === 429 ? 'rate_limited' : 'http_error', res.status); }
      const text = await res.text();
      if (text.length > 10_000_000) throw new ProviderError(provider, 'response_too_large');
      const body: unknown = JSON.parse(text);
      const receipt: Receipt = { provider, endpoint: safeEndpoint, retrievedAt: finishedAt, publishedAt: null, hash: hash(text), simulated: false };
      this.store.cachePut(cacheKey, receipt, text, ttlSeconds);
      this.store.finishReservation(reservation, 'success');
      return { body, receipt, cached: false };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      this.store.finishReservation(reservation, 'transport_or_parse_failure');
      this.store.set(`provider:${provider}`, { at: this.clock(), state: 'error', kind: 'transport_or_parse_failure' });
      // Never persist exception messages containing credential-bearing URLs.
      throw new ProviderError(provider, 'transport_or_parse_failure');
    }
  }
}
