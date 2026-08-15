// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";
import { RankedVariantList, type RankedItemView } from "./components/RankedVariantList.js";
import { SAMPLE_RANKED_ITEMS } from "./pages/variant-review-sample.js";

// Seed a demo session so App renders the guarded workspace, not the login page.
beforeEach(() => {
  localStorage.setItem("udn.session", JSON.stringify({ roleId: "administrator", name: "Dr. Demo Admin" }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const sampleItem: RankedItemView = {
  id: "var-x",
  kind: "variant",
  rank: 1,
  label: "NM_000001.1:c.10A>G",
  score: 42,
  factors: [
    { id: "consequence-severity", label: "Molecular consequence severity", contribution: 20, detail: "Missense" },
    { id: "allele-frequency", label: "Population allele-frequency rarity", contribution: 22, detail: "Rare" }
  ],
  evidenceLinks: [{ id: "e1", label: "Annotation table entry", href: "/case?tab=genomics" }]
};

describe("RankedVariantList", () => {
  it("renders each ranked item with per-factor explanation and evidence links (Req 10.5)", () => {
    render(<RankedVariantList items={[sampleItem]} logicVersion="prioritisation-logic-v1.0.0" />);

    const item = screen.getByTestId("ranked-item-var-x");
    // Per-factor explanation lists every factor with its contribution.
    const factors = within(item).getByTestId("ranked-item-factors-var-x");
    expect(within(factors).getByText("Molecular consequence severity")).toBeTruthy();
    expect(within(factors).getByText("Population allele-frequency rarity")).toBeTruthy();

    // Evidence links are real anchors with accessible text and an href.
    const evidence = within(item).getByTestId("ranked-item-evidence-var-x");
    const link = within(evidence).getByRole("link", { name: "Annotation table entry" });
    expect(link.getAttribute("href")).toBe("/case?tab=genomics");

    // The recorded prioritisation logic version is shown (Req 10.7).
    expect(screen.getByTestId("ranked-variants-logic-version").textContent).toContain(
      "prioritisation-logic-v1.0.0"
    );
  });

  it("shows an empty indication when there are no ranked items", () => {
    render(<RankedVariantList items={[]} />);
    expect(screen.getByTestId("ranked-variants-empty")).toBeTruthy();
  });

  it("renders the ranked list on the Variant-review page (Req 24.1)", () => {
    render(
      <MemoryRouter initialEntries={["/variant-review"]}>
        <App />
      </MemoryRouter>
    );
    const list = screen.getByTestId("ranked-variants-list");
    // One top-level list item per sample ranked variant/gene (evidence links
    // are nested lists, so scope to the ordered list's direct children).
    expect(list.querySelectorAll(":scope > li")).toHaveLength(SAMPLE_RANKED_ITEMS.length);
  });
});
