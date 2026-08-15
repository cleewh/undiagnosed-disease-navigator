import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout.js";
import { RequireAuth } from "./components/RequireAuth.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { LoginPage } from "./pages/LoginPage.js";
import { CaseWorkspacePage } from "./pages/CaseWorkspace.js";
import {
  AuditViewerPage,
  DashboardPage,
  GuidedDemoPage,
  HypothesisBoardPage,
  NotFoundPage,
  PhenotypeReviewPage,
  ReanalysisInboxPage,
  VariantReviewPage
} from "./pages/SimplePages.js";

// Route table for the seven pages (Req 24.1). A demo role picker at /login gates
// the personalised workspace; the AppLayout renders the persistent notice,
// per-role navigation and user chip around every routed page. AuthProvider is
// nested here so both the production BrowserRouter and test routers get context.
export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="case" element={<CaseWorkspacePage />} />
          <Route path="phenotype-review" element={<PhenotypeReviewPage />} />
          <Route path="variant-review" element={<VariantReviewPage />} />
          <Route path="hypothesis-board" element={<HypothesisBoardPage />} />
          <Route path="reanalysis-inbox" element={<ReanalysisInboxPage />} />
          <Route path="audit-viewer" element={<AuditViewerPage />} />
          <Route path="guided-demo" element={<GuidedDemoPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
