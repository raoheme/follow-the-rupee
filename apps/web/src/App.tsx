import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { NotFound } from "./components/NotFound";
import { PagePlaceholder } from "./components/PagePlaceholder";
import { KundaliPage } from "./features/dossier/KundaliPage";
import { TracePage } from "./features/dossier/TracePage";
import { MapListWorkspace } from "./features/map-list/Workspace";
import { ReportFlowProvider } from "./features/report/flow";
import { DuplicatePage } from "./features/report/DuplicatePage";
import { ReceiptPage } from "./features/report/ReceiptPage";
import { ReportPage } from "./features/report/ReportPage";
import { AuthorityPage } from "./features/authority/AuthorityPage";
import { DlpPage } from "./features/authority/DlpPage";
import { JurisdictionWorkPage } from "./features/authority/JurisdictionWorkPage";
import { HOME_PATH, PAGE_ROUTES, type PageRoute } from "./routes";

function pageElement(r: PageRoute) {
  switch (r.pageId) {
    case "PAGE-01":
      return <MapListWorkspace />;
    case "PAGE-02":
      return <KundaliPage />;
    case "PAGE-03":
      return <TracePage />;
    case "PAGE-04":
      return <ReportPage />;
    case "PAGE-05":
      return <DuplicatePage />;
    case "PAGE-06":
      return <ReceiptPage />;
    case "PAGE-08":
      return <AuthorityPage />;
    case "PAGE-09":
      return <JurisdictionWorkPage />;
    case "PAGE-10":
      return <DlpPage />;
    default:
      return <PagePlaceholder page={r} />;
  }
}

/** Route table: one route per wireframe page, all inside the shared shell. Router and providers are supplied by the caller. */
export function App() {
  return (
    <ReportFlowProvider>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={HOME_PATH} replace />} />
        {PAGE_ROUTES.map((r) => (
          <Route
            key={r.pageId}
            path={r.path}
            element={pageElement(r)}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </ReportFlowProvider>
  );
}
