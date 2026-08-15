// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, within, findByText } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";
import { NAV_ITEMS, CASE_WORKSPACE_TABS, RESPONSIBLE_USE_NOTICE } from "./constants.js";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

// The app shell is gated behind the demo role picker; seed a session so the
// routed pages render directly instead of redirecting to /login.
beforeEach(() => {
  localStorage.setItem("udn.session", JSON.stringify({ roleId: "administrator", name: "Dr. Demo Admin" }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("App shell", () => {
  it("renders the persistent Responsible_Use_Notice on every page (Req 24.6, 25.1)", () => {
    renderAt("/");
    const notice = screen.getByTestId("responsible-use-notice");
    expect(notice.textContent).toContain(RESPONSIBLE_USE_NOTICE);
  });

  it("exposes primary navigation to all seven pages (Req 24.1)", () => {
    renderAt("/");
    const nav = screen.getByTestId("primary-navigation");
    expect(NAV_ITEMS).toHaveLength(7);
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByTestId(`nav-${item.id}`)).toBeTruthy();
    }
  });

  it("renders the Case workspace with all twelve tabs (Req 24.2)", async () => {
    const { container } = renderAt("/case");
    // Let the async tab content settle so React state updates flush in act().
    await findByText(container, /Case summary/i);
    const tablist = screen.getByTestId("case-workspace-tablist");
    expect(CASE_WORKSPACE_TABS).toHaveLength(12);
    for (const tab of CASE_WORKSPACE_TABS) {
      expect(within(tablist).getByTestId(`tab-${tab.id}`)).toBeTruthy();
    }
  });

  it("marks exactly one Case workspace tab active (Req 24.3)", async () => {
    const { container } = renderAt("/case");
    await findByText(container, /Case summary/i);
    const selected = screen
      .getByTestId("case-workspace-tablist")
      .querySelectorAll('[aria-selected="true"]');
    expect(selected).toHaveLength(1);
  });

  it("shows the synthetic-data indicator where case data is displayed (Req 1.8)", () => {
    renderAt("/");
    expect(screen.getByTestId("synthetic-data-indicator")).toBeTruthy();
  });
});
