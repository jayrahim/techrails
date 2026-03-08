// @vitest-environment node
// Tests for cloudflare/worker.js
// Runs in Node so we can import the ES-module worker directly and use
// the built-in Request / Response globals from Node 18+.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../cloudflare/worker.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PROD_ENV = { ANTHROPIC_API_KEY: 'sk-ant-test', ENVIRONMENT: 'production' };
const DEV_ENV  = { ANTHROPIC_API_KEY: 'sk-ant-test', ENVIRONMENT: 'development' };

const VALID_ANSWERS = {
  businessStage: '$0\u2013$100k',      // en-dash matches ALLOWED_VALUES set
  chaosArea: ['Finances'],
  currentSystems: ['CRM'],
  biggestFrustration: 'No clarity on cash flow or profit margins',
  businessType: 'Consulting firm',
};

function makeRequest(body, { origin = 'https://ai.techrails.co', method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers['origin'] = origin;
  return new Request('https://ai.techrails.co/api/snapshot', {
    method,
    headers,
    body: method !== 'OPTIONS' ? JSON.stringify(body) : undefined,
  });
}

function mockAnthropicOk(text = 'Primary Structural Gap\nContent here.') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ content: [{ type: 'text', text }] }),
  }));
}

// ── CORS ─────────────────────────────────────────────────────────────────────

describe('worker — CORS preflight', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns 204 on OPTIONS from the allowed origin (production)', async () => {
    const req = new Request('https://ai.techrails.co/api/snapshot', {
      method: 'OPTIONS',
      headers: { origin: 'https://ai.techrails.co' },
    });
    const res = await worker.fetch(req, PROD_ENV);
    expect(res.status).toBe(204);
  });

  it('returns 403 on OPTIONS from a disallowed origin (production)', async () => {
    const req = new Request('https://ai.techrails.co/api/snapshot', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.com' },
    });
    const res = await worker.fetch(req, PROD_ENV);
    expect(res.status).toBe(403);
  });

  it('allows any origin on OPTIONS in development', async () => {
    const req = new Request('https://ai.techrails.co/api/snapshot', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8000' },
    });
    const res = await worker.fetch(req, DEV_ENV);
    expect(res.status).toBe(204);
  });
});

describe('worker — CORS response headers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets the allowed origin header to the production domain', async () => {
    mockAnthropicOk();
    const res = await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://ai.techrails.co');
  });

  it('uses wildcard origin in development mode', async () => {
    mockAnthropicOk();
    const res = await worker.fetch(
      makeRequest({ answers: VALID_ANSWERS }, { origin: 'http://localhost:3000' }),
      DEV_ENV,
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects a POST from a disallowed origin in production', async () => {
    const res = await worker.fetch(
      makeRequest({ answers: VALID_ANSWERS }, { origin: 'https://evil.com' }),
      PROD_ENV,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('allows a POST without an Origin header (server-to-server)', async () => {
    mockAnthropicOk();
    const res = await worker.fetch(
      makeRequest({ answers: VALID_ANSWERS }, { origin: null }),
      PROD_ENV,
    );
    expect(res.status).toBe(200);
  });
});

// ── Method & content-type guards ─────────────────────────────────────────────

describe('worker — method validation', () => {
  it('returns 405 for GET requests', async () => {
    const req = new Request('https://ai.techrails.co/api/snapshot', { method: 'GET' });
    const res = await worker.fetch(req, PROD_ENV);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });
});

describe('worker — content-type validation', () => {
  it('returns 415 when content-type is not application/json', async () => {
    const req = new Request('https://ai.techrails.co/api/snapshot', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        origin: 'https://ai.techrails.co',
      },
      body: 'plain text',
    });
    const res = await worker.fetch(req, PROD_ENV);
    expect(res.status).toBe(415);
  });
});

// ── API key guard ─────────────────────────────────────────────────────────────

describe('worker — API key check', () => {
  it('returns 503 when ANTHROPIC_API_KEY secret is missing', async () => {
    const res = await worker.fetch(
      makeRequest({ answers: VALID_ANSWERS }),
      { ENVIRONMENT: 'production' }, // no API key
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Service unavailable');
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('worker — input validation', () => {
  async function post(answers) {
    return worker.fetch(makeRequest({ answers }), PROD_ENV);
  }

  it('returns 400 when answers payload is missing', async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing or invalid answers');
  });

  it('returns 400 when answers is an array instead of an object', async () => {
    const res = await post([]);
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid businessStage value', async () => {
    const res = await post({ ...VALID_ANSWERS, businessStage: 'Billions' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid businessStage value');
  });

  it('returns 400 for an empty chaosArea array', async () => {
    const res = await post({ ...VALID_ANSWERS, chaosArea: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('chaosArea');
  });

  it('returns 400 for an invalid chaosArea value', async () => {
    const res = await post({ ...VALID_ANSWERS, chaosArea: ['Alien invasion'] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid currentSystems value', async () => {
    const res = await post({ ...VALID_ANSWERS, currentSystems: ['NotRealSoftware'] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when biggestFrustration is empty', async () => {
    const res = await post({ ...VALID_ANSWERS, biggestFrustration: '   ' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('biggestFrustration is required');
  });

  it('returns 400 when biggestFrustration exceeds 500 characters', async () => {
    const res = await post({ ...VALID_ANSWERS, biggestFrustration: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('<= 500');
  });

  it('returns 400 when businessType is missing', async () => {
    const res = await post({ ...VALID_ANSWERS, businessType: '' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('businessType is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('https://ai.techrails.co/api/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://ai.techrails.co' },
      body: 'not-json{',
    });
    const res = await worker.fetch(req, PROD_ENV);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('worker — successful snapshot generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns 200 with { text } on a valid request', async () => {
    mockAnthropicOk('Primary Structural Gap\nReal content here.');
    const res = await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('Primary Structural Gap\nReal content here.');
  });

  it('calls the Anthropic API with the correct model and system prompt', async () => {
    mockAnthropicOk();
    await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);

    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const reqBody = JSON.parse(opts.body);
    expect(reqBody.model).toBe('claude-haiku-4-5');
    expect(reqBody.system).toContain('TechRails diagnostic engine');
    expect(reqBody.messages[0].role).toBe('user');
  });

  it('includes the API key in the request headers', async () => {
    mockAnthropicOk();
    await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    const [, opts] = vi.mocked(fetch).mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
  });
});

// ── Upstream error handling ───────────────────────────────────────────────────

describe('worker — upstream error handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns 502 with a timeout message when the Anthropic call times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }));
    const res = await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('timed out');
  });

  it('returns 502 when the Anthropic API responds with a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 529,
      json: () => Promise.resolve({ error: { message: 'Overloaded' } }),
    }));
    const res = await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    expect(res.status).toBe(502);
  });

  it('returns 502 when the Anthropic response body has no text content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [] }),
    }));
    const res = await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    expect(res.status).toBe(502);
  });

  it('returns 502 when the Anthropic response JSON cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('Unexpected token')),
    }));
    const res = await worker.fetch(makeRequest({ answers: VALID_ANSWERS }), PROD_ENV);
    expect(res.status).toBe(502);
  });
});
