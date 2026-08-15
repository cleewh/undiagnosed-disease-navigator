// @vitest-environment jsdom
//
// End-to-end guided-demo walkthrough test (Task 33.3, Req 29.2/29.3/29.5).
//
// The `.e2e.test.` infix categorises this with the harness's E2E suite
// (Task 32.1 convention). Unlike the render/compile-sanity checks in
// GuidedDemo.test.tsx, this test drives the app through the /guided-demo route
// end to end: it starts at the first step, advances with "Next step" through
// every step (asserting the visible "Step N of M" indicator and that exactly
// one step's content shows at a time), reaches the final step, then uses
// "Previous step" to return and confirms the prior step re-appears. It also
// asserts the exported end-to-end duration helper stays within the documented
// 5-to-7-minute bound.
//
// Queries are accessible-first (roles / accessible names / text), matching the
// conventions in App.test.tsx and accessibility.test.tsx. The one level-2
// heading on the page is the current step's title, so counting level-2 headings
// verifies the one-step-at-a-time invariant (Req 29.2).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";
import {
  GUIDED_DEMO_STEPS,
  GUIDED_DEMO_STEP_COUNT,
  GUIDED_DEMO_MIN_DURATION_SECONDS,
  GUIDED_DEMO_MAX_DURATION_SECONDS,
  totalEstimatedDurationSeconds
} from "./pages/guided-demo-steps.js";

// Seed a demo session so App renders the guarded workspace, not the login page.
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

/** The guided-demo player region (labelled landmark), fetched fresh each call. */
function demoRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Guided demo" });
}

/** The current step's title is the sole level-2 heading rendered in the demo. */
function visibleStepTitle(): string {
  const headings = within(demoRegion()).getAllByRole("heading", { level: 2 });
  // Exactly one step's content is shown at a time (Req 29.2).
  expect(headings).toHaveLength(1);
  const heading = headings[0];
  expect(heading).toBeDefined();
  return heading?.textContent ?? "";
}

function indicatorText(): string {
  // Scope to the demo region: the app shell renders a second role="status"
  // element (the synthetic-data indicator) outside this region.
  return within(demoRegion()).getByRole("status").textContent ?? "";
}

function titleAt(index: number): string {
  const step = GUIDED_DEMO_STEPS[index];
  expect(step).toBeDefined();
  return step?.title ?? "";
}

describe("Guided demo walkthrough (E2E) (Req 29.2, 29.3, 29.5)", () => {
  it("drives the ordered walkthrough from the first step to the final result", () => {
    // The walkthrough must have at least two steps for advance/return to mean
    // anything; the model documents seven.
    expect(GUIDED_DEMO_STEP_COUNT).toBeGreaterThan(1);

    renderAt("/guided-demo");

    // Start at step 1 of N with exactly the first step shown and Previous
    // unavailable (Req 29.2).
    expect(indicatorText()).toBe(`Step 1 of ${GUIDED_DEMO_STEP_COUNT}`);
    expect(visibleStepTitle()).toBe(titleAt(0));
    expect(
      (screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled
    ).toBe(true);

    // Advance through every remaining step, checking the indicator and that
    // the corresponding single step is shown after each advance (Req 29.2/29.5).
    for (let index = 1; index < GUIDED_DEMO_STEP_COUNT; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
      expect(indicatorText()).toBe(`Step ${index + 1} of ${GUIDED_DEMO_STEP_COUNT}`);
      expect(visibleStepTitle()).toBe(titleAt(index));
    }

    // On the final step there is no "Next step" control; a "Restart demo"
    // control is offered instead.
    expect(indicatorText()).toBe(
      `Step ${GUIDED_DEMO_STEP_COUNT} of ${GUIDED_DEMO_STEP_COUNT}`
    );
    expect(screen.queryByRole("button", { name: "Next step" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restart demo" })).toBeTruthy();

    // Returning with "Previous step" re-displays the prior step in order
    // (Req 29.2).
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(indicatorText()).toBe(
      `Step ${GUIDED_DEMO_STEP_COUNT - 1} of ${GUIDED_DEMO_STEP_COUNT}`
    );
    expect(visibleStepTitle()).toBe(titleAt(GUIDED_DEMO_STEP_COUNT - 2));
  });

  it("completes end to end within the documented 5-to-7-minute bound (Req 29.3)", () => {
    const total = totalEstimatedDurationSeconds();
    expect(total).toBeGreaterThanOrEqual(GUIDED_DEMO_MIN_DURATION_SECONDS);
    expect(total).toBeLessThanOrEqual(GUIDED_DEMO_MAX_DURATION_SECONDS);
  });
});
