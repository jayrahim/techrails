/* ================================================================
   TechRails AI — Scripts
   ai.techrails.co
   ================================================================ */

(function () {
  "use strict";

  /* ── Scroll-triggered fade-up animations ── */
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  document.querySelectorAll(".fade-up").forEach((el) => observer.observe(el));

  /* ── Mobile nav toggle ── */
  const toggle = document.querySelector(".nav-toggle");
  const navLinks = document.querySelector(".nav-links");

  if (toggle && navLinks) {
    toggle.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("open");
      toggle.setAttribute("aria-expanded", isOpen);
      toggle.textContent = isOpen ? "\u2715" : "\u2630"; /* ✕ : ☰ */
    });

    // Close menu on any nav link click
    navLinks.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "\u2630";
      });
    });

    // Close menu on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && navLinks.classList.contains("open")) {
        navLinks.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "\u2630";
        toggle.focus();
      }
    });
  }

  /* ── Dynamic copyright year ── */
  const yearEl = document.getElementById("current-year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
