// @vitest-environment jsdom
//
// Render / step-navigation compile-sanity tests for guided demo mode
// (Task 33.2, Req 29.2/29.3/29.5). These cover the ordered step data model, the
// one-step-at-a-time presentation with next/previous navigation and a visible
// step indicator, and the route wiring. The end-to-end timing assertion
// (Task 33.3) is intentionally out of scope here.
import type { ReactElement } from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";
import { GuidedDemo } from "./components/GuidedDemo.js";
import {
  GUIDED_DEMO_STEPS,
  GUIDED_DEMO_STEP_COUNT,
  GUIDED_DEMO_MIN_DURATION_SECONDS,
  GUIDED_DEMO_MAX_DURATION_SECONDS,
  totalEstimatedDurationSeconds
} from "./pages/guided-demo-steps.js";

// Seed a demo session so the App route-wiring tests render the guarded
// workspace instead of redirecting to the /login role picker.
beforeEach(() => {
  localStorage.setItem("udn.session", JSON.stringify({ roleId: "administrator", name: "Dr. Demo Admin" }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Guided demo step model (Req 29.2, 29.3)", () => {
  it("mirrors the seven-stage reanalysis walkthrough with contiguous 1-based ordinals", () => {
    expect(GUIDED_DEMO_STEP_COUNT).toBe(7);
    GUIDED_DEMO_STEPS.forEach((step, index) => {
      expect(step.ordinal).toBe(index + 1);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.summary.length).toBeGreaterThan(0);
      expect(step.details.length).toBeGreaterThan(0);
      expect(step.estimatedDurationSeconds).toBeGreaterThan(0);
    });
  });

  it("completes end to end within the 5-to-7-minute bound (Req 29.3)", () => {
    const total = totalEstimatedDurationSeconds();
    expect(total).toBeGreaterThanOrEqual(GUIDED_DEMO_MIN_DURATION_SECONDS);
    expect(total).toBeLessThanOrEqual(GUIDED_DEMO_MAX_DURATION_SECONDS);
  });
});

function renderDemo(ui: ReactElement) {
  // GuidedDemo renders in-app <Link>s, so it needs a router context.
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("GuidedDemo component (Req 29.2, 29.5)", () => {
  it("shows the first step with a visible 'Step 1 of N' indicator and disabled Previous", () => {
    renderDemo(<GuidedDemo />);
    expect(screen.getByTestId("guided-demo-indicator").textContent).toBe(
      `Step 1 of ${GUIDED_DEMO_STEP_COUNT}`
    );
    const first = GUIDED_DEMO_STEPS[0];
    expect(first).toBeDefined();
    expect(screen.getByTestId("guided-demo-step-title").textContent).toBe(first?.title);
    expect((screen.getByTestId("guided-demo-previous") as HTMLButtonElement).disabled).toBe(true);
  });

  it("presents exactly one step at a time and advances/returns in order", () => {
    renderDemo(<GuidedDemo />);
    // Only one step title (h2) is shown at any time.
    expect(screen.getAllByTestId("guided-demo-step-title")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("guided-demo-next"));
    const second = GUIDED_DEMO_STEPS[1];
    expect(second).toBeDefined();
    expect(screen.getByTestId("guided-demo-indicator").textContent).toBe(
      `Step 2 of ${GUIDED_DEMO_STEP_COUNT}`
    );
    expect(screen.getByTestId("guided-demo-step-title").textContent).toBe(second?.title);

    fireEvent.click(screen.getByTestId("guided-demo-previous"));
    const first = GUIDED_DEMO_STEPS[0];
    expect(screen.getByTestId("guided-demo-indicator").textContent).toBe(
      `Step 1 of ${GUIDED_DEMO_STEP_COUNT}`
    );
    expect(screen.getByTestId("guided-demo-step-title").textContent).toBe(first?.title);
  });

  it("offers a restart control on the final step and returns to the first step", () => {
    renderDemo(<GuidedDemo />);
    for (let i = 0; i < GUIDED_DEMO_STEP_COUNT - 1; i += 1) {
      fireEvent.click(screen.getByTestId("guided-demo-next"));
    }
    expect(screen.getByTestId("guided-demo-indicator").textContent).toBe(
      `Step ${GUIDED_DEMO_STEP_COUNT} of ${GUIDED_DEMO_STEP_COUNT}`
    );
    // No Next control on the last step; a Restart control is offered instead.
    expect(screen.queryByTestId("guided-demo-next")).toBeNull();
    fireEvent.click(screen.getByTestId("guided-demo-restart"));
    expect(screen.getByTestId("guided-demo-indicator").textContent).toBe(
      `Step 1 of ${GUIDED_DEMO_STEP_COUNT}`
    );
  });

  it("renders an empty indication when there are no steps", () => {
    renderDemo(<GuidedDemo steps={[]} />);
    expect(screen.getByTestId("guided-demo-empty")).toBeTruthy();
  });
});

describe("Guided demo route wiring (Req 29.2)", () => {
  it("renders the guided demo on the /guided-demo route", () => {
    render(
      <MemoryRouter initialEntries={["/guided-demo"]}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByTestId("guided-demo")).toBeTruthy();
    expect(screen.getByTestId("guided-demo-indicator").textContent).toBe(
      `Step 1 of ${GUIDED_DEMO_STEP_COUNT}`
    );
  });

  it("exposes a secondary launch link separate from the seven-page primary nav", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );
    const secondary = screen.getByTestId("secondary-navigation");
    expect(secondary).toBeTruthy();
    expect(screen.getByTestId("nav-guided-demo")).toBeTruthy();
    // The primary navigation still lists exactly the seven pages.
    const primary = screen.getByTestId("primary-navigation");
    expect(primary.querySelectorAll("a")).toHaveLength(7);
  });
});
