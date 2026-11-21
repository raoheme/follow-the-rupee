import { LAT_RANGE, LON_RANGE, ISSUE_CATEGORIES, type IssueCategory } from "../map-list/model";
import { isSynId } from "../../lib/synId";

/**
 * PAGE-04 form logic: bounds copied from the contract's `SubmitIssuePayload` (title 1-160, description 1-400, landmark 1-160),
 * the same control-character rule the API applies, and a bounded keyword extraction for the duplicate check. This is input
 * validation only. It does not score, rank or decide anything about duplicates.
 */
export const TITLE_MAX = 160;
export const DESCRIPTION_MAX = 400;
export const LANDMARK_MAX = 160;
export const CAPTION_MAX = 300;
export const KEYWORD_MAX = 40;
/** Keywords sent to the duplicate check: the API accepts up to 20; the UI sends a smaller, deterministic handful. */
export const KEYWORDS_SENT = 12;
const MIN_KEYWORD_LENGTH = 3;

export interface ReportValues {
  category: string;
  title: string;
  description: string;
  landmark: string;
  assetId: string;
  longitude: string;
  latitude: string;
}

export const EMPTY_REPORT: ReportValues = {
  category: "",
  title: "",
  description: "",
  landmark: "",
  assetId: "",
  longitude: "",
  latitude: "",
};

/** The documented demonstration location near the seeded Journey 2 report (GeoJSON order: longitude, latitude). */
export const DEMO_LOCATION = { longitude: "72.83158", latitude: "19.11974" } as const;

export type FieldName = keyof ReportValues;
export type FieldErrorCode =
  | "required"
  | "tooLong"
  | "control"
  | "badNumber"
  | "outOfRange"
  | "badAsset"
  | "badCategory";
export type FieldErrors = Partial<Record<FieldName, FieldErrorCode>>;

const hasControl = (s: string) => /[\u0000-\u001f\u007f-\u009f]/.test(s);

/** Line breaks become single spaces and runs of whitespace collapse: the only rewrite applied before validation. */
export function tidy(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function parseCoordinate(raw: string): number | "bad" {
  const t = raw.trim();
  if (!/^-?\d{1,3}(\.\d{1,8})?$/.test(t)) return "bad";
  return Number(t);
}

export interface SubmitIssuePayload {
  category: IssueCategory;
  geometry: { type: "Point"; coordinates: [number, number] };
  title: string;
  publicDescription: string;
  nearbyLandmark: string | null;
  assetId: string | null;
}

export type ValidationResult =
  | { readonly ok: true; readonly payload: SubmitIssuePayload }
  | { readonly ok: false; readonly errors: FieldErrors };

export function validateReport(v: ReportValues): ValidationResult {
  const errors: FieldErrors = {};
  const text = (name: FieldName, raw: string, max: number, required: boolean) => {
    const t = tidy(raw);
    if (t.length === 0) {
      if (required) errors[name] = "required";
      return t;
    }
    if ([...t].length > max) errors[name] = "tooLong";
    else if (hasControl(t)) errors[name] = "control";
    return t;
  };
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(v.category)) errors.category = v.category ? "badCategory" : "required";
  const title = text("title", v.title, TITLE_MAX, true);
  const description = text("description", v.description, DESCRIPTION_MAX, true);
  const landmark = text("landmark", v.landmark, LANDMARK_MAX, false);
  if (v.assetId !== "" && !isSynId(v.assetId)) errors.assetId = "badAsset";

  const lon = v.longitude.trim() === "" ? undefined : parseCoordinate(v.longitude);
  const lat = v.latitude.trim() === "" ? undefined : parseCoordinate(v.latitude);
  if (lon === undefined) errors.longitude = "required";
  else if (lon === "bad") errors.longitude = "badNumber";
  else if (lon < LON_RANGE[0] || lon > LON_RANGE[1]) errors.longitude = "outOfRange";
  if (lat === undefined) errors.latitude = "required";
  else if (lat === "bad") errors.latitude = "badNumber";
  else if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) errors.latitude = "outOfRange";

  if (Object.keys(errors).length > 0 || typeof lon !== "number" || typeof lat !== "number") return { ok: false, errors };
  return {
    ok: true,
    payload: {
      category: v.category as IssueCategory,
      geometry: { type: "Point", coordinates: [lon, lat] },
      title,
      publicDescription: description,
      nearbyLandmark: landmark === "" ? null : landmark,
      assetId: v.assetId === "" ? null : v.assetId,
    },
  };
}

/** Field order used for the validation summary and focus movement. */
export const FIELD_ORDER: readonly FieldName[] = [
  "category",
  "title",
  "description",
  "landmark",
  "assetId",
  "longitude",
  "latitude",
];

/**
 * Plain tokens from the citizen's own title and description: lower-case alphanumeric words of at least three characters, unique,
 * first-seen order, at most `KEYWORDS_SENT`. They are sent as `descriptionKeywords`; the API decides what they are worth.
 */
export function keywordsFrom(...texts: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) {
    for (const m of t.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
      const w = m[0];
      if (w.length >= MIN_KEYWORD_LENGTH && w.length <= KEYWORD_MAX && !seen.has(w)) {
        seen.add(w);
        if (seen.size >= KEYWORDS_SENT) return [...seen];
      }
    }
  }
  return [...seen];
}

/** Stable text for "is this the same submission as the last attempt?", so a retry reuses its Idempotency-Key and an edit does not. */
export function payloadFingerprint(p: SubmitIssuePayload): string {
  return JSON.stringify(p);
}

export function isEligibleCaption(raw: string): "ok" | "required" | "tooLong" | "control" {
  const t = tidy(raw);
  if (t.length === 0) return "required";
  if ([...t].length > CAPTION_MAX) return "tooLong";
  if (hasControl(t)) return "control";
  return "ok";
}
