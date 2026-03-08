// TechRails — Business Systems Snapshot Widget
// ─────────────────────────────────────────────────────────────────────────────
// API requests are proxied through https://ai.techrails.co/api/snapshot (Cloudflare Worker).
// The worker holds ANTHROPIC_API_KEY as a secret — no key is needed here.
// To deploy the key: wrangler secret put ANTHROPIC_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────

  const PROXY_URL          = 'https://ai.techrails.co/api/snapshot';
  const FETCH_TIMEOUT_MS   = 30_000;
  // Tied to the CSS transition on .snapshot-step — update both together.
  const FOCUS_DELAY_MS     = 60;

  // ── Questions ─────────────────────────────────────────────────────────────

  const QUESTIONS = [
    {
      id: 'businessStage',
      label: 'What stage is your business at?',
      type: 'select',
      options: ['Pre-revenue', '$0\u2013$100k', '$100k\u2013$500k', '$500k+'],
    },
    {
      id: 'chaosArea',
      label: 'Where does your business feel most chaotic?',
      hint: 'Select all that apply',
      type: 'multiselect',
      options: [
        'Finances',
        'Operations',
        'Customer acquisition',
        'Technology',
        'Unclear strategy',
      ],
    },
    {
      id: 'currentSystems',
      label: 'Which systems do you currently use?',
      hint: 'Select all that apply',
      type: 'multiselect',
      options: [
        'Bookkeeping software',
        'CRM',
        'Scheduling tool',
        'None \u2014 mostly manual',
      ],
    },
    {
      id: 'biggestFrustration',
      label: 'What frustrates you most right now?',
      type: 'text',
      placeholder: 'Be specific \u2014 the more detail, the better your snapshot',
    },
    {
      id: 'businessType',
      label: 'What type of business are you running?',
      type: 'text',
      placeholder: 'e.g. Consulting firm, retail shop, freelance design\u2026',
    },
  ];

  const TOTAL = QUESTIONS.length;

  // Section headers in the enforced output format — used as safe-to-render
  // static strings in renderResults; never user-supplied.
  const SECTION_HEADS = [
    'Primary Structural Gap',
    'Common symptoms at this stage:',
    'Recommended Focus \u2014 Next 30 Days',
    'What a Full Systems Audit Would Cover',
  ];

  // ── State ─────────────────────────────────────────────────────────────────

  let currentStep = 0;
  const answers   = {};

  // ── DOM refs ──────────────────────────────────────────────────────────────

  const widget = document.getElementById('snapshot-widget');
  if (!widget) return;

  const progressFill  = widget.querySelector('.snapshot-progress-fill');
  const progressLabel = widget.querySelector('.snapshot-progress-label');
  const progressRow   = widget.querySelector('.snapshot-progress-row');
  const stepsEl       = widget.querySelector('.snapshot-steps');
  const loadingEl     = widget.querySelector('.snapshot-loading');
  const resultsEl     = widget.querySelector('.snapshot-results');
  const resultsBody   = widget.querySelector('.snapshot-results-body');
  const errorEl       = widget.querySelector('.snapshot-error');
  const errorMsg      = widget.querySelector('.snapshot-error-msg');

  // ── XSS prevention ────────────────────────────────────────────────────────

  // All AI-generated text (seeded by user input) must pass through escapeHtml
  // before being inserted via innerHTML.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Build steps ───────────────────────────────────────────────────────────

  function buildSteps() {
    stepsEl.innerHTML = '';

    QUESTIONS.forEach((q, i) => {
      const div = document.createElement('div');
      div.className = 'snapshot-step' + (i === 0 ? ' active' : '');
      div.dataset.step = i;

      // All content here comes from the QUESTIONS constant — no user input.
      let field = '';
      if (q.type === 'text') {
        field = `<input class="snapshot-input" type="text" autocomplete="off"
          placeholder="${q.placeholder}" aria-label="${q.label}" />`;
      } else if (q.type === 'select') {
        const opts = q.options
          .map(o => `<option value="${o}">${o}</option>`)
          .join('');
        field = `<select class="snapshot-input snapshot-select" aria-label="${q.label}">
          <option value="" disabled selected>Select one\u2026</option>${opts}
        </select>`;
      } else if (q.type === 'multiselect') {
        const checks = q.options
          .map(o => `<label class="snapshot-check-label">
            <input type="checkbox" value="${o}" /><span>${o}</span>
          </label>`)
          .join('');
        field = (q.hint ? `<p class="snapshot-q-hint">${q.hint}</p>` : '')
          + `<div class="snapshot-checks" role="group" aria-label="${q.label}">${checks}</div>`;
      }

      const isLast  = i === TOTAL - 1;
      const backBtn = i > 0
        ? `<button type="button" class="snapshot-back btn-ghost">\u2190 Back</button>`
        : '';
      const fwdBtn  = isLast
        ? `<button type="button" class="snapshot-generate btn-primary">Generate My Snapshot</button>`
        : `<button type="button" class="snapshot-next btn-primary">Next \u2192</button>`;

      div.innerHTML = `<p class="snapshot-q">${q.label}</p>${field}
        <div class="snapshot-actions">${backBtn}${fwdBtn}</div>`;

      stepsEl.appendChild(div);
    });

    stepsEl.querySelectorAll('.snapshot-next').forEach(b => b.addEventListener('click', advanceStep));
    stepsEl.querySelectorAll('.snapshot-back').forEach(b => b.addEventListener('click', retreatStep));
    stepsEl.querySelectorAll('.snapshot-generate').forEach(b => b.addEventListener('click', handleSubmit));

    stepsEl.querySelectorAll('.snapshot-input[type="text"]').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const stepIdx = parseInt(inp.closest('.snapshot-step').dataset.step, 10);
        stepIdx === TOTAL - 1 ? handleSubmit() : advanceStep();
      });
    });
  }

  // ── Step navigation ───────────────────────────────────────────────────────

  function getStepEl(i) {
    return stepsEl.querySelector(`.snapshot-step[data-step="${i}"]`);
  }

  function collectAnswer(stepIdx) {
    const q  = QUESTIONS[stepIdx];
    const el = getStepEl(stepIdx);
    if (q.type === 'text') {
      answers[q.id] = el.querySelector('.snapshot-input').value.trim();
    } else if (q.type === 'select') {
      answers[q.id] = el.querySelector('.snapshot-select').value;
    } else if (q.type === 'multiselect') {
      answers[q.id] = Array.from(
        el.querySelectorAll('input[type="checkbox"]:checked')
      ).map(c => c.value);
    }
  }

  function restoreAnswer(stepIdx) {
    const q   = QUESTIONS[stepIdx];
    const el  = getStepEl(stepIdx);
    const val = answers[q.id];
    if (!val) return;
    if (q.type === 'text') {
      el.querySelector('.snapshot-input').value = val;
    } else if (q.type === 'select') {
      el.querySelector('.snapshot-select').value = val;
    } else if (q.type === 'multiselect') {
      el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = val.includes(cb.value);
      });
    }
  }

  function validate() {
    const q  = QUESTIONS[currentStep];
    const el = getStepEl(currentStep);
    clearFieldError();

    if (q.type === 'text') {
      const inp = el.querySelector('.snapshot-input');
      if (!inp.value.trim()) {
        showFieldError(inp, 'Please enter a response to continue.');
        return false;
      }
    } else if (q.type === 'select') {
      const sel = el.querySelector('.snapshot-select');
      if (!sel.value) {
        showFieldError(sel, 'Please select an option to continue.');
        return false;
      }
    } else if (q.type === 'multiselect') {
      const checked = el.querySelector('input[type="checkbox"]:checked');
      if (!checked) {
        showFieldError(el.querySelector('.snapshot-checks'), 'Please select at least one option.');
        return false;
      }
    }
    return true;
  }

  function showFieldError(anchor, msg) {
    const p = document.createElement('p');
    p.className = 'snapshot-field-error';
    p.setAttribute('role', 'alert');
    p.textContent = msg;
    anchor.insertAdjacentElement('afterend', p);
  }

  function clearFieldError() {
    stepsEl.querySelectorAll('.snapshot-field-error').forEach(e => e.remove());
  }

  function setStep(newIdx) {
    getStepEl(currentStep).classList.remove('active');
    currentStep = newIdx;
    const next = getStepEl(currentStep);
    next.classList.add('active');
    restoreAnswer(currentStep);
    updateProgress();
    const focusEl = next.querySelector('input, select');
    // Delay matches the CSS display transition on .snapshot-step.active
    if (focusEl) setTimeout(() => focusEl.focus(), FOCUS_DELAY_MS);
  }

  function advanceStep() {
    if (!validate()) return;
    collectAnswer(currentStep);
    setStep(currentStep + 1);
  }

  function retreatStep() {
    // Collect without validation so a partially-filled step is saved and
    // restored correctly if the user comes back to it.
    collectAnswer(currentStep);
    setStep(currentStep - 1);
  }

  function updateProgress() {
    progressFill.style.width = (currentStep / TOTAL * 100) + '%';
    progressLabel.textContent = `Step ${currentStep + 1} of ${TOTAL}`;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit() {
    if (!validate()) return;
    collectAnswer(currentStep);

    stepsEl.classList.add('hidden');
    progressRow.classList.add('hidden');
    loadingEl.removeAttribute('hidden');

    callProxy()
      .then(text => {
        loadingEl.setAttribute('hidden', '');
        renderResults(text);
      })
      .catch(err => {
        console.error('[Snapshot]', err);
        loadingEl.setAttribute('hidden', '');
        showWidgetError(
          'We couldn\u2019t generate your snapshot right now. Please try again, or book a call below.'
        );
      });
  }

  // ── API proxy call ────────────────────────────────────────────────────────

  function callProxy() {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    return fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
      signal: controller.signal,
    })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          return res.json().catch(() => ({})).then(body => {
            throw new Error(body.error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then(data => {
        if (typeof data.text !== 'string') throw new Error('Unexpected response shape from proxy');
        return data.text;
      });
  }

  // ── Render results ────────────────────────────────────────────────────────

  function renderResults(text) {
    if (typeof text !== 'string' || !text.trim()) {
      showWidgetError('The snapshot came back empty. Please try again.');
      return;
    }

    const lines = text.split('\n');
    let html = '';
    let i    = 0;

    // Skip the title line ("TechRails Systems Snapshot") and separator ("────…")
    let titleSkipped = 0;
    while (i < lines.length && titleSkipped < 2) {
      if (lines[i].trim()) titleSkipped++;
      i++;
    }

    let currentSection = null;
    let listType       = null;  // 'ul' | 'ol' | null
    let listItems      = [];

    function flushList() {
      if (!listItems.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      html += `<${tag} class="result-list">${
        listItems.map(li => `<li>${li}</li>`).join('')
      }</${tag}>`;
      listItems = [];
      listType  = null;
    }

    function openSection(heading) {
      flushList();
      if (currentSection) html += '</div></div>';
      currentSection = heading;
      // Section headings come from SECTION_HEADS — they are static JS strings,
      // not user input, so they are safe to insert without escaping.
      html += `<div class="result-section">
        <h3 class="result-heading">${heading}</h3>
        <div class="result-content">`;
    }

    for (; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) { flushList(); continue; }

      // Known static section heading?
      const headMatch = SECTION_HEADS.find(h => trimmed === h);
      if (headMatch) { openSection(headMatch); continue; }

      // Layer label e.g. [Layer 3 — Financial Systems] — from AI response, escape it.
      if (/^\[Layer/.test(trimmed)) {
        html += `<p class="result-layer">${escapeHtml(trimmed.replace(/^\[|\]$/g, ''))}</p>`;
        continue;
      }

      // Numbered list item — from AI response, escape content.
      if (/^\d+\.\s/.test(trimmed)) {
        if (listType !== 'ol') { flushList(); listType = 'ol'; }
        listItems.push(escapeHtml(trimmed.replace(/^\d+\.\s*/, '')));
        continue;
      }

      // Bullet list item — from AI response, escape content.
      if (/^[-\u2013\u2022]\s/.test(trimmed)) {
        if (listType !== 'ul') { flushList(); listType = 'ul'; }
        listItems.push(escapeHtml(trimmed.replace(/^[-\u2013\u2022]\s*/, '')));
        continue;
      }

      // Regular paragraph — from AI response, escape content.
      flushList();
      html += `<p>${escapeHtml(trimmed)}</p>`;
    }

    flushList();
    if (currentSection) html += '</div></div>';

    // Fallback: if the model didn't follow the format, render escaped plain text.
    if (!html) {
      html = `<div class="result-section"><div class="result-content"><p>${
        escapeHtml(text)
      }</p></div></div>`;
    }

    resultsBody.innerHTML = html;
    resultsEl.removeAttribute('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Error state ───────────────────────────────────────────────────────────

  function showWidgetError(msg) {
    stepsEl.classList.add('hidden');
    progressRow.classList.add('hidden');
    loadingEl.setAttribute('hidden', '');

    errorMsg.textContent = msg;

    // Add a "Try again" button if not already present. Clicking it returns the
    // user to the last step with all answers intact so they only need to
    // re-submit — no data re-entry required.
    if (!errorEl.querySelector('.snapshot-retry')) {
      const retryBtn = document.createElement('button');
      retryBtn.type      = 'button';
      retryBtn.className = 'snapshot-retry btn-ghost';
      retryBtn.textContent = 'Try again';
      retryBtn.addEventListener('click', resetToForm);
      errorMsg.insertAdjacentElement('afterend', retryBtn);
    }

    errorEl.removeAttribute('hidden');
  }

  function resetToForm() {
    errorEl.setAttribute('hidden', '');
    stepsEl.classList.remove('hidden');
    progressRow.classList.remove('hidden');
    // Return to the last step — answers are preserved; user just re-submits.
    getStepEl(currentStep).classList.add('active');
    updateProgress();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  buildSteps();
  updateProgress();

})();
