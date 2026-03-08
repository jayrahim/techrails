// Tests for ai/js/snapshot.js
// The widget is an IIFE — it executes on import as a side effect.
// We reset modules and re-import in each test so the IIFE runs against a fresh DOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Minimal DOM structure expected by snapshot.js
const WIDGET_HTML = `
<div id="snapshot-widget">
  <div class="snapshot-progress-row">
    <div class="snapshot-progress-fill"></div>
    <span class="snapshot-progress-label"></span>
  </div>
  <div class="snapshot-steps"></div>
  <div class="snapshot-loading" hidden></div>
  <div class="snapshot-results" hidden>
    <div class="snapshot-results-body"></div>
  </div>
  <div class="snapshot-error" hidden>
    <p class="snapshot-error-msg"></p>
  </div>
</div>
`;

async function mountWidget() {
  document.body.innerHTML = WIDGET_HTML;
  vi.resetModules();
  await import('../ai/js/snapshot.js');
}

// Flush promise microtask queue — callProxy() chains multiple .then() calls
async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

const $ = (sel) => document.querySelector(sel);
const step = (n) => document.querySelector(`.snapshot-step[data-step="${n}"]`);

function currentStep() {
  const active = document.querySelector('.snapshot-step.active');
  return active ? parseInt(active.dataset.step, 10) : 0;
}

// Fill a step with a valid answer based on its field type
function fillStep(n) {
  const s = step(n);
  const sel = s.querySelector('.snapshot-select');
  if (sel) {
    sel.value = '$0\u2013$100k'; // en-dash matches QUESTIONS constant
    return;
  }
  const cb = s.querySelector('input[type="checkbox"]');
  if (cb) {
    cb.checked = true;
    return;
  }
  const inp = s.querySelector('.snapshot-input');
  if (inp) {
    inp.value = `Test answer ${n}`;
  }
}

// Advance the widget to a target step index by filling and clicking Next on each prior step
async function advanceTo(targetStep) {
  for (let i = 0; i < targetStep; i++) {
    fillStep(i);
    step(i).querySelector('.snapshot-next, .snapshot-generate')?.click();
    await Promise.resolve();
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Snapshot widget — initial render', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mountWidget();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows "Step 1 of 5" in the progress label', () => {
    expect($('.snapshot-progress-label').textContent).toBe('Step 1 of 5');
  });

  it('renders exactly 5 step elements', () => {
    expect(document.querySelectorAll('.snapshot-step').length).toBe(5);
  });

  it('activates only the first step', () => {
    expect(document.querySelectorAll('.snapshot-step.active').length).toBe(1);
    expect(document.querySelector('.snapshot-step.active').dataset.step).toBe('0');
  });

  it('hides loading, results, and error panels', () => {
    expect($('.snapshot-loading').hasAttribute('hidden')).toBe(true);
    expect($('.snapshot-results').hasAttribute('hidden')).toBe(true);
    expect($('.snapshot-error').hasAttribute('hidden')).toBe(true);
  });

  it('renders a Next button on step 0', () => {
    expect(step(0).querySelector('.snapshot-next')).not.toBeNull();
  });

  it('renders a Generate button (not Next) on the last step', () => {
    expect(step(4).querySelector('.snapshot-generate')).not.toBeNull();
    expect(step(4).querySelector('.snapshot-next')).toBeNull();
  });
});

describe('Snapshot widget — validation', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mountWidget();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('blocks advance on empty select and shows a field error', () => {
    step(0).querySelector('.snapshot-next').click();
    expect(currentStep()).toBe(0);
    expect($('.snapshot-field-error')).not.toBeNull();
  });

  it('clears the field error after a valid selection', () => {
    step(0).querySelector('.snapshot-next').click(); // trigger error
    step(0).querySelector('.snapshot-select').value = 'Pre-revenue';
    step(0).querySelector('.snapshot-next').click();
    expect($('.snapshot-field-error')).toBeNull();
  });

  it('blocks advance on unchecked multiselect', async () => {
    await advanceTo(1);
    step(1).querySelector('.snapshot-next').click();
    expect(currentStep()).toBe(1);
    expect($('.snapshot-field-error')).not.toBeNull();
  });

  it('blocks generate on empty last-step text field', async () => {
    await advanceTo(4);
    step(4).querySelector('.snapshot-generate').click();
    expect(currentStep()).toBe(4);
    expect($('.snapshot-field-error')).not.toBeNull();
  });
});

describe('Snapshot widget — step navigation', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mountWidget();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('advances to step 1 after filling step 0', () => {
    step(0).querySelector('.snapshot-select').value = '$500k+';
    step(0).querySelector('.snapshot-next').click();
    expect(currentStep()).toBe(1);
    expect($('.snapshot-progress-label').textContent).toBe('Step 2 of 5');
  });

  it('retreats to step 0 after advancing', () => {
    step(0).querySelector('.snapshot-select').value = 'Pre-revenue';
    step(0).querySelector('.snapshot-next').click();
    step(1).querySelector('.snapshot-back').click();
    expect(currentStep()).toBe(0);
  });

  it('preserves select value after back navigation', () => {
    step(0).querySelector('.snapshot-select').value = '$500k+';
    step(0).querySelector('.snapshot-next').click();
    step(1).querySelector('.snapshot-back').click();
    expect(step(0).querySelector('.snapshot-select').value).toBe('$500k+');
  });

  it('preserves text value after back navigation', async () => {
    await advanceTo(3);
    step(3).querySelector('.snapshot-input').value = 'My frustration';
    step(3).querySelector('.snapshot-next').click();
    step(4).querySelector('.snapshot-back').click();
    expect(step(3).querySelector('.snapshot-input').value).toBe('My frustration');
  });

  it('step 0 has no Back button', () => {
    expect(step(0).querySelector('.snapshot-back')).toBeNull();
  });
});

describe('Snapshot widget — submit flow', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mountWidget();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('hides steps and shows loading immediately on generate', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Primary Structural Gap\nContent.' }),
    });

    await advanceTo(4);
    step(4).querySelector('.snapshot-input').value = 'Consulting firm';
    step(4).querySelector('.snapshot-generate').click();

    expect($('.snapshot-steps').classList.contains('hidden')).toBe(true);
    expect($('.snapshot-loading').hasAttribute('hidden')).toBe(false);
  });

  it('calls the proxy URL with a POST containing all answers', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Primary Structural Gap\nContent.' }),
    });

    // Step 0: select
    step(0).querySelector('.snapshot-select').value = '$0\u2013$100k';
    step(0).querySelector('.snapshot-next').click();
    // Step 1: multiselect (chaosArea)
    step(1).querySelectorAll('input[type="checkbox"]')[0].checked = true;
    step(1).querySelector('.snapshot-next').click();
    // Step 2: multiselect (currentSystems)
    step(2).querySelectorAll('input[type="checkbox"]')[1].checked = true;
    step(2).querySelector('.snapshot-next').click();
    // Step 3: text (biggestFrustration)
    step(3).querySelector('.snapshot-input').value = 'Cash flow issues';
    step(3).querySelector('.snapshot-next').click();
    // Step 4: text (businessType)
    step(4).querySelector('.snapshot-input').value = 'Consulting firm';
    step(4).querySelector('.snapshot-generate').click();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://ai.techrails.co/api/snapshot');
    expect(opts.method).toBe('POST');
    expect(opts.headers['content-type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.answers.businessStage).toBe('$0\u2013$100k');
    expect(body.answers.biggestFrustration).toBe('Cash flow issues');
    expect(body.answers.businessType).toBe('Consulting firm');
    expect(Array.isArray(body.answers.chaosArea)).toBe(true);
  });
});

describe('Snapshot widget — results rendering', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mountWidget();
  });

  afterEach(() => vi.unstubAllGlobals());

  async function submit(text) {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text }),
    });
    await advanceTo(4);
    step(4).querySelector('.snapshot-input').value = 'Consulting firm';
    step(4).querySelector('.snapshot-generate').click();
    await flushPromises();
  }

  it('reveals the results panel after a successful fetch', async () => {
    await submit('Primary Structural Gap\nSome analysis here.');
    expect($('.snapshot-results').hasAttribute('hidden')).toBe(false);
  });

  it('hides the loading panel after fetch resolves', async () => {
    await submit('Primary Structural Gap\nSome analysis here.');
    expect($('.snapshot-loading').hasAttribute('hidden')).toBe(true);
  });

  it('renders section headings from the AI response', async () => {
    await submit(
      'TechRails Systems Snapshot\n─────────────────────────────\n\n' +
      'Primary Structural Gap\n[Layer 3 — Financial Systems]\n\n' +
      'You lack bookkeeping structure.'
    );
    const body = $('.snapshot-results-body');
    expect(body.querySelector('.result-heading')?.textContent).toBe('Primary Structural Gap');
  });

  it('escapes HTML in AI-generated text to prevent XSS', async () => {
    await submit('Primary Structural Gap\n<script>alert(1)</script>');
    const html = $('.snapshot-results-body').innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders bullet list items as <ul>', async () => {
    await submit(
      'Primary Structural Gap\n- First symptom\n- Second symptom'
    );
    expect($('.snapshot-results-body .result-list')).not.toBeNull();
  });

  it('uses fallback plain-text block when response has no section headings', async () => {
    await submit('Something completely unstructured without any known headings.');
    expect($('.snapshot-results-body .result-section')).not.toBeNull();
  });
});

describe('Snapshot widget — error handling', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mountWidget();
  });

  afterEach(() => vi.unstubAllGlobals());

  async function triggerError() {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    await advanceTo(4);
    step(4).querySelector('.snapshot-input').value = 'Consulting firm';
    step(4).querySelector('.snapshot-generate').click();
    await flushPromises();
  }

  it('shows the error panel on fetch failure', async () => {
    await triggerError();
    expect($('.snapshot-error').hasAttribute('hidden')).toBe(false);
  });

  it('shows a user-friendly error message', async () => {
    await triggerError();
    expect($('.snapshot-error-msg').textContent).toContain('couldn\u2019t generate');
  });

  it('renders a retry button', async () => {
    await triggerError();
    expect($('.snapshot-retry')).not.toBeNull();
  });

  it('retry returns the user to the form with steps visible', async () => {
    await triggerError();
    $('.snapshot-retry').click();
    expect($('.snapshot-error').hasAttribute('hidden')).toBe(true);
    expect($('.snapshot-steps').classList.contains('hidden')).toBe(false);
    expect($('.snapshot-progress-row').classList.contains('hidden')).toBe(false);
  });

  it('shows error panel when proxy returns a non-OK HTTP status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'Service unavailable' }),
    });
    await advanceTo(4);
    step(4).querySelector('.snapshot-input').value = 'Consulting firm';
    step(4).querySelector('.snapshot-generate').click();
    await flushPromises();
    expect($('.snapshot-error').hasAttribute('hidden')).toBe(false);
  });
});
