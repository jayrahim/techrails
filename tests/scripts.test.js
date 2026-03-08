// Tests for js/main.js (homepage) and ai/js/scripts.js (AI page)
// Both files are IIFEs — they execute on import as a side effect.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const NAV_HTML = `
<nav class="site-nav">
  <button class="nav-toggle" aria-expanded="false">&#9776;</button>
  <ul class="nav-links" id="primary-nav">
    <li><a href="#services">Services</a></li>
    <li><a href="#contact">Contact</a></li>
  </ul>
</nav>
<div class="fade-up">Animated element 1</div>
<div class="fade-up">Animated element 2</div>
`;

// Run test suites for both nav script files with the same expectations
for (const [label, modulePath] of [
  ['main.js (homepage)', '../js/main.js'],
  ['scripts.js (AI page)', '../ai/js/scripts.js'],
]) {
  describe(`${label} — mobile nav toggle`, () => {
    beforeEach(async () => {
      document.body.innerHTML = NAV_HTML;
      vi.resetModules();
      await import(modulePath);
    });

    it('opens the nav menu on toggle click', () => {
      document.querySelector('.nav-toggle').click();
      expect(document.querySelector('.nav-links').classList.contains('open')).toBe(true);
    });

    it('sets aria-expanded="true" when menu opens', () => {
      document.querySelector('.nav-toggle').click();
      expect(document.querySelector('.nav-toggle').getAttribute('aria-expanded')).toBe('true');
    });

    it('closes the nav menu on second toggle click', () => {
      const toggle = document.querySelector('.nav-toggle');
      toggle.click();
      toggle.click();
      expect(document.querySelector('.nav-links').classList.contains('open')).toBe(false);
    });

    it('sets aria-expanded="false" when menu closes', () => {
      const toggle = document.querySelector('.nav-toggle');
      toggle.click();
      toggle.click();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes the nav on Escape key when open', () => {
      document.querySelector('.nav-toggle').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.querySelector('.nav-links').classList.contains('open')).toBe(false);
    });

    it('does not toggle state on unrelated keydown events', () => {
      document.querySelector('.nav-toggle').click(); // open
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.querySelector('.nav-links').classList.contains('open')).toBe(true);
    });

    it('closes the nav when a nav link is clicked', () => {
      document.querySelector('.nav-toggle').click(); // open
      document.querySelector('.nav-links a').click();
      expect(document.querySelector('.nav-links').classList.contains('open')).toBe(false);
    });

    it('resets aria-expanded to false after link click', () => {
      document.querySelector('.nav-toggle').click();
      document.querySelector('.nav-links a').click();
      expect(document.querySelector('.nav-toggle').getAttribute('aria-expanded')).toBe('false');
    });

    it('Escape key does nothing when menu is already closed', () => {
      // aria-expanded stays false, no errors thrown
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.querySelector('.nav-toggle').getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe(`${label} — IntersectionObserver scroll animations`, () => {
    beforeEach(async () => {
      document.body.innerHTML = NAV_HTML;
      vi.resetModules();
      await import(modulePath);
    });

    it('calls observe() on each .fade-up element', () => {
      const observeMock = IntersectionObserver.mock.results.at(-1)?.value.observe;
      expect(observeMock).toHaveBeenCalledTimes(2);
    });
  });
}
