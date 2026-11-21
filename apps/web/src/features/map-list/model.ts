import { z } from "zod";
import { ApiHttpError } from "../../api/errors";
import { ISSUE_STATUSES } from "../../components/status";

/**
 * Response models for the two P3 read operations (openapi.yaml `MapFeatureCollectionResult` and `IssueListResult`).
 * Only the fields PAGE-01 actually shows are declared; unknown members are ignored, missing or mistyped ones fail the
 * parse so a drifting server is reported honestly instead of being rendered half-wrong.
 *
 * Coordinates are GeoJSON [longitude, latitude]. A position outside the contract's Greater Mumbai bounds is rejected,
 * because a swapped pair would otherwise draw silently in the wrong place.
 */
export const LON_RANGE = [72.77, 72.99] as const;
export const LAT_RANGE = [18.89, 19.275] as const;
/** Full Greater Mumbai bounds as `minLon,minLat,maxLon,maxLat`; PAGE-01 asks for all of it so map and list cover the same set. */
export const FULL_BBOX = `${LON_RANGE[0]},${LAT_RANGE[0]},${LON_RANGE[1]},${LAT_RANGE[1]}`;

const position = z
  .tuple([z.number(), z.number()])
  .refine(([lon, lat]) => lon >= LON_RANGE[0] && lon <= LON_RANGE[1] && lat >= LAT_RANGE[0] && lat <= LAT_RANGE[1], {
    message: "position is outside Greater Mumbai or not [longitude, latitude]",
  });

export const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: position }),
  z.object({ type: z.literal("LineString"), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position).min(4)).min(1) }),
]);
export type Geometry = z.infer<typeof geometrySchema>;

export const FEATURE_KINDS = ["ISSUE", "ASSET", "PUBLIC_WORK"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export const ISSUE_CATEGORIES = ["POTHOLE", "DRAIN_BLOCKAGE", "WATERLOGGING", "FACILITY_REPAIR"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

const synId = z.string().regex(/^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$/);

export const mapFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: synId,
  geometry: geometrySchema,
  properties: z.object({
    kind: z.enum(FEATURE_KINDS),
    recordId: synId,
    title: z.string(),
    category: z.enum(ISSUE_CATEGORIES).nullable(),
    status: z.string().nullable(),
    wardId: synId.nullable(),
    dlpActive: z.boolean(),
    recordNature: z.literal("SYNTHETIC_DEMONSTRATION"),
  }),
});
export type MapFeature = z.infer<typeof mapFeatureSchema>;

export const mapFeatureCollectionResultSchema = z.object({
  data: z.object({ type: z.literal("FeatureCollection"), features: z.array(mapFeatureSchema) }),
  correlationId: z.string().min(1),
});

export const issueSummarySchema = z.object({
  id: synId,
  recordNature: z.literal("SYNTHETIC_DEMONSTRATION"),
  /** Returned by the API; optional here so PAGE-01 fixtures without it keep parsing. PAGE-05 never invents a missing version. */
  recordVersion: z.number().int().min(1).optional(),
  title: z.string(),
  publicDescription: z.string(),
  category: z.enum(ISSUE_CATEGORIES),
  status: z.enum(ISSUE_STATUSES),
  publicStatusExplanation: z.string(),
  reportedAt: z.string(),
  streetName: z.string(),
  nearbyLandmark: z.string(),
  geometry: geometrySchema,
  assetId: synId.nullable(),
  workOrderId: synId.nullable(),
  wardCandidateId: synId.nullable(),
});
export type IssueSummary = z.infer<typeof issueSummarySchema>;

export const issueListResultSchema = z.object({
  data: z.object({ items: z.array(issueSummarySchema), total: z.number().int().min(0) }),
  correlationId: z.string().min(1),
});

export interface Parsed<T> {
  readonly data: T;
  readonly correlationId: string;
}

/** Parse a success body; a body that does not match the contract is an HTTP-level error, never rendered data. */
export function parseResult<S extends z.ZodType<{ data: unknown; correlationId: string }>>(
  schema: S,
  body: unknown,
  status = 200,
): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiHttpError(status, "OK", "unexpected-shape", "application/json");
  return r.data;
}

/** Eligible issue ids carried by a map response (assets and public works are not issues). */
export function issueIdsOnMap(features: readonly MapFeature[]): string[] {
  return features.filter((f) => f.properties.kind === "ISSUE").map((f) => f.id);
}

export interface ParityResult {
  readonly ok: boolean;
  readonly onlyInList: readonly string[];
  readonly onlyOnMap: readonly string[];
}

/**
 * Map/list parity: both responses are the complete eligible set for the same filters, so the issue ids must be identical.
 * A mismatch is surfaced to the user as partial data rather than hidden.
 */
export function compareParity(listIds: readonly string[], mapIssueIds: readonly string[]): ParityResult {
  const l = new Set(listIds);
  const m = new Set(mapIssueIds);
  const onlyInList = [...l].filter((id) => !m.has(id)).sort();
  const onlyOnMap = [...m].filter((id) => !l.has(id)).sort();
  return { ok: onlyInList.length === 0 && onlyOnMap.length === 0, onlyInList, onlyOnMap };
}
