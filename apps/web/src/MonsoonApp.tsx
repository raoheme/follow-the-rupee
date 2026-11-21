import { Navigate, Route, Routes } from "react-router-dom";
import { AuditorPage } from "./features/monsoon/Auditor";
import { KundaliPage } from "./features/monsoon/KundaliPage";
import { MapPage } from "./features/monsoon/MapPage";
import { MonsoonShell } from "./features/monsoon/MonsoonShell";
import { PlannerPage } from "./features/monsoon/Planner";
import { ScorecardsPage } from "./features/monsoon/Scorecards";
import { NotFound } from "./components/NotFound";

/** Six destinations; the legacy /page-NN paths stay as aliases (the Citizen Bot path redirects to the Kundali id search). */
export function MonsoonApp() {
  return (
    <Routes>
      <Route element={<MonsoonShell />}>
        <Route index element={<MapPage />} />
        <Route path="/page-01" element={<MapPage />} />
        <Route path="/auditor" element={<AuditorPage />} />
        <Route path="/page-08" element={<AuditorPage />} />
        <Route path="/scorecards" element={<ScorecardsPage />} />
        <Route path="/page-03" element={<ScorecardsPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/page-09" element={<PlannerPage />} />
        <Route path="/kundali" element={<KundaliPage />} />
        <Route path="/page-02" element={<KundaliPage />} />
        <Route path="/page-04" element={<Navigate to="/kundali" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
