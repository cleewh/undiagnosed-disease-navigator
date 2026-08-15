// @vitest-environment jsdom
//
// E2E-style accessibility and responsiveness SMOKE tests for the app shell
// (Task 9.2). These cover the *programmatically verifiable* WCAG 2.1 AA floor
// (Req 24.4) and a lightweight responsive check across the 375–767px range
// (Req 24.5).
//
// IMPORTANT: automated tooling can only detect a subset of WCAG 2.1 AA success
// criteria. Full conformance additionally requires manual testing with
// assistive technologies (screen readers, keyboard-only navigation) and human
// expert review. Likewise, true responsive-layout verification (actual pixel
// reflow / horizontal-scroll detection) needs a real browser engine; jsdom
// performs no layout, so the responsiveness assertions here are a smoke test
// that guards against loss of content/functionality and obvious overflow-
// inducing inline styles at a mobile viewport width.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, render, findByText } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { App } from "./App.js";
import { NAV_ITEMS } from "./constants.js";

// Mirror the production document shell (apps/web/index.html sets both), because
// jsdom starts each test with a bare <html> and empty <title>. Without this the
// scan would flag html-has-lang (WCAG 3.1.1) / document-title (WCAG 2.4.2) as
// artefacts of the test environment rather than real app defects.
beforeAll(() => {
  document.documentElement.lang = "en";
  document.title = "Undiagnosed Disease Case Navigator";
});

// Seed a demo session so the guarded app shell renders instead of redirecting
// to the /login role picker.
beforeEach(() => {
  localStorage.setItem("udn.session", JSON.stringify({ roleId: "administrator", name: "Dr. Demo Admin" }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

// Restrict the scan to the WCAG 2.1 A/AA rule tags — the criteria the task
// treats as the programmatically-verifiable floor (Req 24.4).
const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scanForViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: WCAG_21_AA_TAGS },
    // color-contrast (WCAG 1.4.3) requires real layout + painting to compute
    // pixel colours, which jsdom does not perform. It therefore cannot be
    // programmatically verified here and is deferred to a real-browser E2E.
    rules: { "color-contrast": { enabled: false } }
  });
  return results.violations;
}

// The pages exercised by the smoke suite: the Dashboard, the Case workspace,
// and two additional pages, each reached through the real route table. `settle`
// is a unique fragment of that page's main content used to wait for the view
// (and any async section) to finish rendering before scanning.
const PAGES: ReadonlyArray<{ readonly name: string; readonly path: string; readonly settle: RegExp }> = [
  { name: "Dashboard", path: "/", settle: /Welcome,/i },
  { name: "Case workspace", path: "/case", settle: /Case summary/i },
  { name: "Phenotype-review", path: "/phenotype-review", settle: /Review and confirm extracted phenotype/i },
  { name: "Variant-review", path: "/variant-review", settle: /Ranked variants and genes/i }
];

describe("Accessibility (axe-core, WCAG 2.1 AA programmatically verifiable) — Req 24.4", () => {
  for (const page of PAGES) {
    it(`has no automatically-detectable WCAG 2.1 AA violations on ${page.name}`, async () => {
      const { container } = renderAt(page.path);
      // Let async tab/section content settle so the DOM axe scans is stable.
      await findByText(container, page.settle);
      const violations = await scanForViolations(container);
      // Surface a readable summary if anything fails.
      const summary = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`).join("\n");
      expect(summary === "" ? [] : violations, `axe violations:\n${summary}`).toHaveLength(0);
    });
  }

  it("verifies presence of the primary navigation, all seven pages, and the persistent notice (Req 24.1, 24.6)", async () => {
    const { container } = renderAt("/");
    await findByText(container, /Welcome,/i);
    expect(container.querySelector('[data-testid="primary-navigation"]')).not.toBeNull();
    for (const item of NAV_ITEMS) {
      expect(container.querySelector(`[data-testid="nav-${item.id}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="responsible-use-notice"]')).not.toBeNull();
    // Exactly one <main> landmark and one <h1> per view (WCAG landmark/heading order).
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Responsiveness smoke check (Req 24.5). jsdom does not lay out or paint, so
// this cannot measure real reflow. It instead asserts that, when the viewport
// is narrowed to the 375px mobile floor, (a) no content or functionality is
// lost (all pages, tabs and the notice remain reachable) and (b) no rendered
// element carries an inline style that would force horizontal scrolling of
// primary content. Genuine reflow verification belongs in a real browser E2E.
// ---------------------------------------------------------------------------

const MOBILE_MIN_WIDTH = 375;
const MOBILE_MAX_WIDTH = 767;

function stubViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      // Parse a `max-width: Npx` / `min-width: Npx` query and evaluate it
      // against the stubbed width so components relying on matchMedia behave
      // as they would at this viewport.
      const maxMatch = /max-width:\s*(\d+)px/.exec(query);
      const minMatch = /min-width:\s*(\d+)px/.exec(query);
      let matches = true;
      if (maxMatch && maxMatch[1]) matches = matches && width <= Number(maxMatch[1]);
      if (minMatch && minMatch[1]) matches = matches && width >= Number(minMatch[1]);
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      } as unknown as MediaQueryList;
    }
  });
}

// Inline styles that would push primary content wider than the viewport.
function findOverflowingInlineStyles(container: HTMLElement, viewportWidth: number): string[] {
  const offenders: string[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>("[style]"))) {
    const style = el.getAttribute("style") ?? "";
    // Fixed pixel widths / min-widths larger than the viewport.
    for (const prop of ["width", "min-width"]) {
      const m = new RegExp(`${prop}:\\s*(\\d+)px`).exec(style);
      if (m && m[1] && Number(m[1]) > viewportWidth) {
        offenders.push(`${el.tagName.toLowerCase()} ${prop}:${m[1]}px`);
      }
    }
    // Non-wrapping text forces horizontal scroll on narrow viewports.
    if (/white-space:\s*nowrap/.test(style)) {
      offenders.push(`${el.tagName.toLowerCase()} white-space:nowrap`);
    }
  }
  return offenders;
}

describe("Responsiveness smoke test (375–767px) — Req 24.5", () => {
  for (const width of [MOBILE_MIN_WIDTH, MOBILE_MAX_WIDTH]) {
    it(`retains all navigation, notice and content with no overflow-inducing inline styles at ${width}px`, async () => {
      stubViewport(width);
      // Case workspace is the densest view (12 tabs) — the worst case for a
      // narrow viewport, so we exercise it here.
      const { container } = renderAt("/case");
      await findByText(container, /Case summary/i);

      // (a) No loss of content/functionality: notice, nav (all 7 links) and the
      // full 12-tab tablist are still present at the mobile viewport.
      expect(container.querySelector('[data-testid="responsible-use-notice"]')).not.toBeNull();
      for (const item of NAV_ITEMS) {
        expect(container.querySelector(`[data-testid="nav-${item.id}"]`)).not.toBeNull();
      }
      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs).toHaveLength(12);

      // (b) No inline style forces horizontal scrolling of primary content.
      const offenders = findOverflowingInlineStyles(container, width);
      expect(offenders, `overflow-inducing inline styles at ${width}px:\n${offenders.join("\n")}`).toHaveLength(0);
    });
  }
});
