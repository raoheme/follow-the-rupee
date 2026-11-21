import type { Language } from "../../i18n/resources";

export const STRIP_TEXT = "Mumbai Civic Lens · Follow the Rupee · Synthetic Challenge Dataset (Not Official BMC Data)";
export const OVERLAP_NOTE = "Categories overlap and are not an estimate of confirmed loss.";
export const SLA_NOTE = "SLA performance is shown alongside low-lying ward exposure. The dataset does not establish causation.";
export const DLP_CAVEAT = "DLP status is temporal/contextual evidence and does not prove contractual applicability or liability.";
export const DLP_DEFER = "Defer new municipal repair allocation pending DLP scope review";
export const TREATMENT_LABEL = "Candidate treatment for engineering review";
export const ENG_REVIEW = "Engineering review required";
export const SURVIVAL_LABEL = "30-day survival-adjusted standard rate (illustrative)";
export const CENTROID_BADGE = "Locality centroid (coarse, not exact GPS)";
export const CLAUDE_BADGE = "Claude-authored brief (offline reviewed)";
export const DETERMINISTIC_BADGE = "Deterministic summary";

export const TABS = [
  { key: "map", path: "/", en: "Map Triage", hi: "मानचित्र ट्रायाज", mr: "नकाशा ट्रायाज" },
  { key: "auditor", path: "/auditor", en: "Repair Auditor", hi: "मरम्मत ऑडिटर", mr: "दुरुस्ती ऑडिटर" },
  { key: "scorecards", path: "/scorecards", en: "Scorecards & Wards", hi: "स्कोरकार्ड और वार्ड", mr: "स्कोअरकार्ड आणि वॉर्ड" },
  { key: "planner", path: "/planner", en: "Next-Rupee Planner", hi: "अगला-रुपया योजनाकार", mr: "पुढचा-रुपया नियोजक" },
  { key: "kundali", path: "/kundali", en: "Trail Kundali", hi: "ट्रेल कुंडली", mr: "ट्रेल कुंडली" },
] as const;

export function tabLabel(t: (typeof TABS)[number], lang: Language): string {
  return t[lang] ?? t.en;
}

export const LENSES = [
  { key: "ward_officer", label: "Ward Officer", hint: "Start from your ward on Map Triage and the Next-Rupee Planner." },
  { key: "auditor", label: "Corporator / Auditor", hint: "Start from the Repair Auditor and the Scorecards." },
  { key: "citizen", label: "Citizen", hint: "Start from Trail Kundali: look up any complaint, work order or road id." },
] as const;

export const AUTHOR_LABEL = (author: string | null | undefined): string =>
  author && author.toLowerCase().includes("claude") ? CLAUDE_BADGE : DETERMINISTIC_BADGE;

export const FLAG_CLASSES = [
  ["PRIMARY_REVIEW_FLAG", "Primary Review Flags"],
  ["TRACEABILITY_GAP", "Traceability Gaps"],
  ["CONTEXT_INDICATOR", "Context Indicators"],
  ["OUTCOME_INDICATOR", "Outcome Indicators"],
  ["ALL", "All"],
] as const;

export const FLAG_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["RATE_CARD_VARIANCE_REVIEW", "Rate-card variance review"],
  ["HIGH_CONFIDENCE_DUPLICATE_CANDIDATE", "Possible duplicate billing candidate"],
  ["DLP_SURFACE_REPAIR_REVIEW", "DLP surface repair review"],
  ["UNLINKED_WORK_ORDER", "No linked complaint"],
  ["DLP_CONTEXT_ONLY", "DLP context only"],
  ["REPEATED_WORK_REVIEW", "Repeated work review"],
  ["REOPENED_WITHIN_30D", "Reopened within 30 days"],
  ["SLA_MISSED", "SLA not met"],
];

export const VARIANCE_BANDS = ["REVIEW", "HIGH_VARIANCE_REVIEW", "VERY_HIGH_VARIANCE_REVIEW"] as const;
export const BAND_LABEL: Record<string, string> = {
  REVIEW: "Review",
  HIGH_VARIANCE_REVIEW: "High variance review",
  VERY_HIGH_VARIANCE_REVIEW: "Very high variance review",
};
