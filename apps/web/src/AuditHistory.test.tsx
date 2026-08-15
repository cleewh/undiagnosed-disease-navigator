// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";
import { AuditHistory, type AuditEventView } from "./components/AuditHistory.js";
import { SAMPLE_LIBRARY_AUDIT_EVENTS } from "./pages/audit-history-sample.js";

// Seed a demo session so App renders the guarded workspace, not the login page.
beforeEach(() => {
  localStorage.setItem("udn.session", JSON.stringify({ roleId: "administrator", name: "Dr. Demo Admin" }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const plainEvent: AuditEventView = {
  id: "aud-x",
  actorId: "user:geneticist-synthetic-01",
  action: "approve",
  affectedObjectId: "analysis-run-synthetic-0007",
  at: "2025-02-14T11:42:19Z"
};

const correctionEvent: AuditEventView = {
  id: "aud-y",
  actorId: "user:bioinformatician-synthetic-02",
  action: "modify",
  affectedObjectId: "variant-synthetic-0148",
  at: "2025-02-14T09:31:07Z",
  correction: {
    originalValue: "Likely benign (AI-suggested)",
    correctedValue: "Uncertain significance (clinician-confirmed)"
  }
};

describe("AuditHistory", () => {
  it("renders actor, action, affected object and a UTC timestamp for each event (Req 22.2)", () => {
    render(<AuditHistory events={[plainEvent]} />);

    const row = screen.getByTestId("audit-event-aud-x");
    expect(within(row).getByText("user:geneticist-synthetic-01")).toBeTruthy();
    expect(within(row).getByText("Approve")).toBeTruthy();
    expect(within(row).getByText("analysis-run-synthetic-0007")).toBeTruthy();

    // The timestamp is a <time> with a machine-readable UTC dateTime and an
    // explicit UTC display with second-level precision.
    const time = within(screen.getByTestId("audit-event-timestamp-aud-x")).getByText(/UTC/);
    expect(time.getAttribute("dateTime")).toBe("2025-02-14T11:42:19Z");
    expect(time.textContent).toContain("2025-02-14 11:42:19 UTC");
  });

  it("shows both original and corrected values for corrections (Req 22.4)", () => {
    render(<AuditHistory events={[correctionEvent]} />);
    const cell = screen.getByTestId("audit-event-correction-aud-y");
    expect(within(cell).getByText("Likely benign (AI-suggested)")).toBeTruthy();
    expect(within(cell).getByText("Uncertain significance (clinician-confirmed)")).toBeTruthy();
  });

  it("shows an empty indication when there are no audit events", () => {
    render(<AuditHistory events={[]} />);
    expect(screen.getByTestId("audit-history-empty")).toBeTruthy();
  });

  it("renders the audit history on the Audit viewer page (Req 24.1)", () => {
    render(
      <MemoryRouter initialEntries={["/audit-viewer"]}>
        <App />
      </MemoryRouter>
    );
    const table = screen.getByTestId("audit-history-table");
    expect(table.querySelectorAll("tbody > tr")).toHaveLength(SAMPLE_LIBRARY_AUDIT_EVENTS.length);
  });

  it("renders the audit history on the Case workspace Audit-history tab (Req 24.2)", async () => {
    render(
      <MemoryRouter initialEntries={["/case"]}>
        <App />
      </MemoryRouter>
    );
    const auditTab = await screen.findByTestId("tab-audit-history");
    auditTab.click();
    expect(await screen.findByTestId("audit-history-table")).toBeTruthy();
  });
});
