// @vitest-environment jsdom
//
// Interaction tests for the local-state controls added to the workspace: the
// Phenotype-review approve/reject flow and the Reanalysis inbox before/after
// expansion. These render the real app (with a seeded demo session) so they
// also exercise the route + shell wiring.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";

beforeEach(() => {
  localStorage.setItem("udn.session", JSON.stringify({ roleId: "clinical_geneticist", name: "Dr. Ada Okonkwo" }));
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

describe("Phenotype-review interactions", () => {
  it("confirms a candidate and updates the review tally", () => {
    renderAt("/phenotype-review");

    const card = screen.getByTestId("phenotype-HP:0001250");
    expect(within(card).getByRole("button", { name: "Approve" })).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));

    // The card now shows a Confirmed decision with an Undo affordance.
    expect(within(card).getByText("Confirmed")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Undo" })).toBeTruthy();
    // The progress tally reflects one confirmed candidate.
    expect(screen.getByText("1 confirmed")).toBeTruthy();

    // Undo returns it to pending and the Approve control comes back.
    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));
    expect(within(card).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByText("0 confirmed")).toBeTruthy();
  });
});

describe("Reanalysis inbox interactions", () => {
  it("expands a before/after comparison on review", () => {
    renderAt("/reanalysis-inbox");

    const reviewButtons = screen.getAllByRole("button", { name: "Review" });
    expect(reviewButtons.length).toBeGreaterThan(0);

    const firstButton = reviewButtons[0];
    expect(firstButton).toBeDefined();
    if (!firstButton) return;

    fireEvent.click(firstButton);

    // A comparison region appears and the control flips to "Hide".
    expect(screen.getByRole("heading", { name: /Before \/ after/i })).toBeTruthy();
    expect(firstButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("changed").length).toBeGreaterThan(0);
  });
});
