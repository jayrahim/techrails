# TechRails

**Business clarity for entrepreneurs.**
Technology and financial systems that bring structure and control to growing businesses.

- **Main site** → [techrails.co](https://techrails.co)
- **AI Tools** → [ai.techrails.co](https://ai.techrails.co)

---

## Repository structure

```
techrails/
├── index.html              # Main site (techrails.co)
├── css/styles.css
├── js/main.js
├── assets/                 # Favicons, logo, images
├── privacy.html
├── terms.html
│
├── ai/                     # AI subdomain (ai.techrails.co)
│   ├── index.htm
│   ├── css/styles.css
│   ├── js/
│   │   ├── snapshot.js     # Business Systems Snapshot widget
│   │   └── scripts.js
│   └── assets/
│
├── cloudflare/             # Cloudflare Worker (API proxy)
│   ├── worker.js
│   └── wrangler.toml
│
├── tests/                  # Vitest test suite
│   ├── setup.js
│   ├── snapshot.test.js
│   ├── scripts.test.js
│   └── worker.test.js
│
├── robots.txt
├── sitemap.xml
└── CNAME                   # techrails.co (GitHub Pages)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Cloudflare DNS                             │
│                                                                     │
│   techrails.co ──────────────────────────────► GitHub Pages        │
│   ai.techrails.co ───────────────────────────► GitHub Pages        │
│   ai.techrails.co/api/snapshot ──────────────► Cloudflare Worker   │
└─────────────────────────────────────────────────────────────────────┘

                         GitHub Pages
            ┌────────────────────────────────────┐
            │                                    │
            │   techrails.co        (repo root)  │
            │   ├── index.html                   │
            │   ├── css/styles.css               │
            │   └── js/main.js                   │
            │                                    │
            │   ai.techrails.co     (ai/ dir)    │
            │   ├── index.htm                    │
            │   ├── css/styles.css               │
            │   └── js/                          │
            │       ├── snapshot.js  ──────────────────────┐
            │       └── scripts.js               │         │
            └────────────────────────────────────┘         │
                                                    POST /api/snapshot
                                                           │
                                                           ▼
                                              ┌────────────────────────┐
                                              │   Cloudflare Worker    │
                                              │                        │
                                              │  1. Validate origin    │
                                              │  2. Validate inputs    │
                                              │  3. Build prompt       │
                                              │  4. Call Anthropic     │
                                              │  5. Return { text }    │
                                              └──────────┬─────────────┘
                                                         │
                                                         ▼
                                              ┌────────────────────────┐
                                              │   Anthropic API        │
                                              │   claude-haiku-4-5     │
                                              │                        │
                                              │   Structured snapshot  │
                                              │   diagnostic report    │
                                              └────────────────────────┘
```

---

## Hosting

| Domain | Platform | Source |
|---|---|---|
| `techrails.co` | GitHub Pages | repo root |
| `ai.techrails.co` | GitHub Pages | `ai/` subdirectory |
| `ai.techrails.co/api/snapshot` | Cloudflare Worker | `cloudflare/` |

The `CNAME` file points GitHub Pages to `techrails.co`. The `ai.techrails.co` subdomain is routed separately via Cloudflare DNS.

---

## Business Systems Snapshot

The AI-powered widget on the AI page walks users through a 5-step form and returns a structured diagnostic report via Claude.

**Request flow:**

```
Browser (ai.techrails.co)
  → POST /api/snapshot  (Cloudflare Worker)
    → Anthropic Messages API (claude-haiku-4-5)
      → structured diagnostic text
    ← { text: "..." }
  ← rendered result card
```

The Cloudflare Worker:
- Keeps the Anthropic API key server-side (never in the browser)
- Validates and allowlists all enum inputs before forwarding
- Enforces CORS to `ai.techrails.co` and `techrails.co` only (production)
- Applies a 25-second upstream timeout with `AbortController`

---

## Development

### Prerequisites

- Node.js 18+ (for tests)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (for the Worker)

### Run the test suite

```bash
npm install
npm test          # run once
npm run test:watch  # watch mode
```

### Run the worker locally

```bash
cd cloudflare
wrangler dev
```

The worker runs at `http://localhost:8787` in dev mode. To point the snapshot widget at it locally, temporarily update `PROXY_URL` in `ai/js/snapshot.js`.

### Local secrets

Create `cloudflare/.dev.vars` (gitignored) for local Worker development:

```ini
ANTHROPIC_API_KEY=sk-ant-...
ENVIRONMENT=development
```

---

## Deployment

### Site (GitHub Pages)

Push to `main`. GitHub Pages deploys automatically.

### Worker (Cloudflare)

```bash
cd cloudflare

# First-time: set the API key secret
wrangler secret put ANTHROPIC_API_KEY

# Deploy
wrangler deploy --env production
```

The Worker route (`ai.techrails.co/api/snapshot`) and Zone ID are configured in `wrangler.toml`.

---

## Tests

77 tests across three files:

| File | Tests | Covers |
|---|---|---|
| `tests/snapshot.test.js` | 28 | Widget render, validation, step navigation, submit, results, XSS prevention, error/retry |
| `tests/scripts.test.js` | 20 | Nav toggle, Escape key, link-close, IntersectionObserver — run against both nav scripts |
| `tests/worker.test.js` | 27 | CORS, method/content-type guards, API key check, input validation, happy path, upstream errors |

---

## Security notes

- Anthropic API key is a Wrangler secret — never committed
- All free-text inputs are capped at 500 characters and sanitized before prompt injection
- Enum inputs are validated against strict allowlists server-side
- AI-generated output is HTML-escaped before `innerHTML` insertion
- CORS restricted to `techrails.co` and `ai.techrails.co` in production

---

## License

Proprietary. © 2026 Enterprise Investments, LLC. All rights reserved.
