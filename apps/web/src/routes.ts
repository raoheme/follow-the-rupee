/**
 * Authoritative PAGE-01..PAGE-12 route inventory for the shell.
 *
 * Page ids and English names are taken from wireframes/pages.json (checked by routes.test.ts so the two cannot drift).
 * No controlling file defines URL paths, so each path is derived mechanically from the page id (PAGE-01 -> /page-01),
 * never from a page title. `owningPhases` records which later phase fills the page in, per the P01-P12 gate order
 * and the supplementary v1.2.2 reference guide (non-controlling); it is shown to the user as a plain placeholder note.
 */
export const PAGE_IDS = [
  "PAGE-01",
  "PAGE-02",
  "PAGE-03",
  "PAGE-04",
  "PAGE-05",
  "PAGE-06",
  "PAGE-07",
  "PAGE-08",
  "PAGE-09",
  "PAGE-10",
  "PAGE-11",
  "PAGE-12",
] as const;

export type PageId = (typeof PAGE_IDS)[number];

export interface PageRoute {
  readonly pageId: PageId;
  readonly path: string;
  /** i18n key holding the page name. */
  readonly nameKey: string;
  /** English name; must equal wireframes/pages.json (verified in tests). */
  readonly englishName: string;
  readonly owningPhases: readonly string[];
}

const def = (pageId: PageId, englishName: string, owningPhases: readonly string[]): PageRoute => ({
  pageId,
  path: `/${pageId.toLowerCase()}`,
  nameKey: `page.${pageId}.name`,
  englishName,
  owningPhases,
});

export const PAGE_ROUTES: readonly PageRoute[] = [
  def("PAGE-01", "Map/List Workspace", ["P3"]),
  def("PAGE-02", "Kundali Dossier", ["P4"]),
  def("PAGE-03", "Work/Budget Trace", ["P4"]),
  def("PAGE-04", "Report Issue", ["P5"]),
  def("PAGE-05", "Duplicate Decision", ["P5"]),
  def("PAGE-06", "Submission Receipt", ["P5"]),
  def("PAGE-07", "Resolution Verification", ["P7"]),
  def("PAGE-08", "Authority Command", ["P6"]),
  def("PAGE-09", "Jurisdiction/Work Link", ["P6"]),
  def("PAGE-10", "Completion/DLP", ["P6", "P7"]),
  def("PAGE-11", "Correction/Audit", ["P7"]),
  def("PAGE-12", "Demo/Methodology", ["P7"]),
];

/** Index route target. PAGE-01 is the Map/List home in the wireframe set. */
export const HOME_PATH = PAGE_ROUTES[0]!.path;

export function routeForPath(pathname: string): PageRoute | undefined {
  return PAGE_ROUTES.find((r) => r.path === pathname);
}
