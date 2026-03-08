// TechRails — Business Snapshot Proxy Worker
// Cloudflare Worker that proxies snapshot requests to the Anthropic API.
//
// Deploy:
//   wrangler deploy
//
// Set your API key (never commit it):
//   wrangler secret put ANTHROPIC_API_KEY
//
// Optional but recommended:
//   Set ENVIRONMENT=development locally and ENVIRONMENT=production in Cloudflare.
//
// IMPORTANT:
// This worker does not implement rate limiting itself.
// Before going to production, add a Cloudflare Rate Limiting rule or Turnstile
// to prevent abuse and control Anthropic API cost.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const MAX_RESPONSE_TOKENS = 400;
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_TEXT_LENGTH = 500;
const ALLOWED_ORIGIN = "https://ai.techrails.co";

// Allowlists for enum fields — values must match exactly what the frontend sends.
const ALLOWED_VALUES = {
  businessStage: new Set(["Pre-revenue", "$0–$100k", "$100k–$500k", "$500k+"]),
  chaosArea: new Set([
    "Finances",
    "Operations",
    "Customer acquisition",
    "Technology",
    "Unclear strategy",
  ]),
  currentSystems: new Set([
    "Bookkeeping software",
    "CRM",
    "Scheduling tool",
    "None — mostly manual",
  ]),
};

const SYSTEM_PROMPT =
  "You are the TechRails diagnostic engine — a business systems advisor that analyzes " +
  "small businesses through the TechRails 5-layer infrastructure framework: " +
  "Layer 1 Legal & Identity, Layer 2 Communication & Presence, Layer 3 Financial Systems, " +
  "Layer 4 Operations & Delivery, Layer 5 Growth & Visibility. " +
  "You produce structured diagnostic reports, not conversational responses. " +
  "Your tone is direct, specific, and expert — never generic, never hollow.";

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin");

    // CORS preflight
    if (request.method === "OPTIONS") {
      if (requestOrigin && !isAllowedOrigin(requestOrigin, env)) {
        return new Response(null, { status: 403 });
      }
      return corsResponse(null, 204, env);
    }

    // Reject browser cross-origin requests from disallowed origins.
    // Requests without Origin (e.g. curl, server-to-server) are allowed.
    if (requestOrigin && !isAllowedOrigin(requestOrigin, env)) {
      return corsResponse(
        JSON.stringify({ error: "Forbidden" }),
        403,
        env,
      );
    }

    if (request.method !== "POST") {
      return corsResponse(
        JSON.stringify({ error: "Method not allowed" }),
        405,
        env,
      );
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return corsResponse(
        JSON.stringify({ error: "Content-Type must be application/json" }),
        415,
        env,
      );
    }

    if (!env.ANTHROPIC_API_KEY) {
      console.error("[snapshot] Missing ANTHROPIC_API_KEY secret");
      return corsResponse(
        JSON.stringify({ error: "Service unavailable" }),
        503,
        env,
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(
        JSON.stringify({ error: "Invalid JSON body" }),
        400,
        env,
      );
    }

    const validationError = validateAnswers(body?.answers);
    if (validationError) {
      return corsResponse(
        JSON.stringify({ error: validationError }),
        400,
        env,
      );
    }

    const prompt = buildPrompt(body.answers);

    let anthropicRes;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      anthropicRes = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: MAX_RESPONSE_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const isTimeout = err?.name === "AbortError";
      console.error(
        "[snapshot] Upstream fetch error:",
        err?.name,
        err?.message,
      );
      return corsResponse(
        JSON.stringify({
          error: isTimeout
            ? "Request timed out — please try again"
            : "Upstream request failed",
        }),
        502,
        env,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      console.error(
        "[snapshot] Anthropic API error:",
        anthropicRes.status,
        errBody?.error?.message,
      );
      return corsResponse(
        JSON.stringify({
          error: "Could not generate snapshot — please try again",
        }),
        502,
        env,
      );
    }

    let data;
    try {
      data = await anthropicRes.json();
    } catch (err) {
      console.error(
        "[snapshot] Failed to parse Anthropic response body:",
        err?.message,
      );
      return corsResponse(
        JSON.stringify({ error: "Invalid response from upstream" }),
        502,
        env,
      );
    }

    const text =
      typeof data?.content?.[0]?.text === "string"
        ? data.content[0].text.trim()
        : "";
    if (!text) {
      console.error("[snapshot] Anthropic response missing text content");
      return corsResponse(
        JSON.stringify({
          error: "Could not generate snapshot — please try again",
        }),
        502,
        env,
      );
    }

    return corsResponse(JSON.stringify({ text }), 200, env);
  },
};

// ── Input validation ───────────────────────────────────────────────────────────

function validateAnswers(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return "Missing or invalid answers payload";
  }

  if (!ALLOWED_VALUES.businessStage.has(answers.businessStage)) {
    return "Invalid businessStage value";
  }

  if (!isNonEmptyArrayOf(answers.chaosArea, ALLOWED_VALUES.chaosArea)) {
    return "Invalid chaosArea — must be a non-empty array of allowed values";
  }

  if (
    !isNonEmptyArrayOf(answers.currentSystems, ALLOWED_VALUES.currentSystems)
  ) {
    return "Invalid currentSystems — must be a non-empty array of allowed values";
  }

  if (
    typeof answers.biggestFrustration !== "string" ||
    !answers.biggestFrustration.trim()
  ) {
    return "biggestFrustration is required";
  }

  if (answers.biggestFrustration.length > MAX_TEXT_LENGTH) {
    return `biggestFrustration must be <= ${MAX_TEXT_LENGTH} characters`;
  }

  if (
    typeof answers.businessType !== "string" ||
    !answers.businessType.trim()
  ) {
    return "businessType is required";
  }

  if (answers.businessType.length > MAX_TEXT_LENGTH) {
    return `businessType must be <= ${MAX_TEXT_LENGTH} characters`;
  }

  return null;
}

function isNonEmptyArrayOf(value, allowedSet) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => allowedSet.has(v))
  );
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function sanitize(str) {
  return String(str).slice(0, MAX_TEXT_LENGTH).replace(/\0/g, "").trim();
}

function buildPrompt(answers) {
  const chaosArea = answers.chaosArea.join(", ");
  const currentSystems = answers.currentSystems.join(", ");

  return (
    "Diagnose this business using the TechRails 5-layer framework.\n\n" +
    `Business type: <business_type>${sanitize(answers.businessType)}</business_type>\n` +
    `Revenue stage: ${answers.businessStage}\n` +
    `Areas of chaos: ${chaosArea}\n` +
    `Current systems in use: ${currentSystems}\n` +
    `Biggest frustration: <frustration>${sanitize(answers.biggestFrustration)}</frustration>\n\n` +
    "Produce a TechRails Systems Snapshot using this exact structure and format:\n\n" +
    "TechRails Systems Snapshot\n" +
    "─────────────────────────────\n\n" +
    "Primary Structural Gap\n" +
    "[Layer X — Layer Name]\n\n" +
    "[2 sentences identifying the core systems weakness based on their inputs.]\n\n" +
    "Common symptoms at this stage:\n" +
    "- [symptom 1]\n" +
    "- [symptom 2]\n" +
    "- [symptom 3]\n\n" +
    "Recommended Focus — Next 30 Days\n" +
    "1. [Specific action]\n" +
    "2. [Specific action]\n" +
    "3. [Specific action]\n\n" +
    "What a Full Systems Audit Would Cover\n" +
    "- [item specific to their situation]\n" +
    "- [item specific to their situation]\n" +
    "- [item specific to their situation]\n\n" +
    "Strict formatting rules:\n" +
    "- Maximum 180 words total\n" +
    "- Exactly 3 symptoms\n" +
    "- Exactly 3 recommended actions\n" +
    "- Exactly 3 audit coverage bullets\n" +
    "- Each bullet must be no more than 12 words\n" +
    "- The Primary Structural Gap section must be no more than 2 short sentences\n" +
    '- Do NOT add headings, titles, or introduction text before "Primary Structural Gap"\n' +
    "- Do not include introductions, conclusions, explanations, or commentary\n" +
    "- Do not add any text outside this structure\n" +
    "Write like a compact diagnostic report."
  );
}

// ── CORS helpers ───────────────────────────────────────────────────────────────

function isDevelopment(env) {
  return env?.ENVIRONMENT === "development";
}

function isAllowedOrigin(origin, env) {
  if (isDevelopment(env)) return true;
  return origin === ALLOWED_ORIGIN;
}

function corsResponse(body, status, env) {
  const allowOrigin = isDevelopment(env) ? "*" : ALLOWED_ORIGIN;

  const headers = {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };

  if (body !== null) {
    headers["content-type"] = "application/json";
  }

  return new Response(body, { status, headers });
}
