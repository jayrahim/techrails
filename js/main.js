/* ================================================================
   TechRails — Homepage Scripts
   techrails.co
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

    // Close mobile menu on link click
    navLinks.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "\u2630"; /* ☰ */
      });
    });

    // Close mobile menu on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && navLinks.classList.contains("open")) {
        navLinks.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "\u2630";
        toggle.focus();
      }
    });
  }
})();
