import { useState } from "react";
import { CASE_WORKSPACE_TABS } from "../constants.js";
import { Page } from "../components/Page.js";
import { RetryableSection } from "../components/RetryableSection.js";
import { CaseHeader, renderCaseTabContent } from "./case-workspace-content.js";

// Case workspace with all twelve tabs and an active-tab indication
// (Requirements 24.2, 24.3). Each tab renders clearly-synthetic clinical
// content (see case-workspace-content) wrapped in a retryable loader so a
// failed tab load shows an error + retry (Req 24.7).
export function CaseWorkspacePage() {
  const firstTab = CASE_WORKSPACE_TABS[0];
  const [activeTabId, setActiveTabId] = useState<string>(firstTab ? firstTab.id : "overview");

  const activeTab = CASE_WORKSPACE_TABS.find((tab) => tab.id === activeTabId) ?? firstTab;

  return (
    <Page title="Case workspace" showsCaseData classification="research">
      <CaseHeader />

      <div
        role="tablist"
        aria-label="Case workspace sections"
        data-testid="case-workspace-tablist"
        className="tablist"
      >
        {CASE_WORKSPACE_TABS.map((tab) => {
          const isActive = activeTab !== undefined && tab.id === activeTab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              data-testid={`tab-${tab.id}`}
              className={isActive ? "tab tab--active" : "tab"}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab && (
        <div
          role="tabpanel"
          id={`panel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
          data-testid={`panel-${activeTab.id}`}
        >
          <RetryableSection
            key={activeTab.id}
            name={`${activeTab.label} tab`}
            load={() => Promise.resolve(renderCaseTabContent(activeTab.id))}
          />
        </div>
      )}
    </Page>
  );
}
