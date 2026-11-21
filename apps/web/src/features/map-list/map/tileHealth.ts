/**
 * Bounded basemap-failure detector. Tiles are optional visual enrichment; vector features never depend on them.
 *
 * Leaflet fires one `tileerror` per failed tile, which would otherwise be an unbounded stream of updates. This counts
 * errors and loads and reports "unavailable" exactly once (a one-way latch for the lifetime of the map), after
 * `threshold` errors with no tile having loaded. Later events are ignored, so there is no per-tile state-update loop.
 */
export class TileHealth {
  private errors = 0;
  private loads = 0;
  private reported = false;

  constructor(
    private readonly onUnavailable: () => void,
    private readonly threshold = 4,
  ) {}

  tileLoaded(): void {
    this.loads += 1;
  }

  tileFailed(): void {
    if (this.reported) return;
    this.errors += 1;
    if (this.loads === 0 && this.errors >= this.threshold) {
      this.reported = true;
      this.onUnavailable();
    }
  }

  /** Start a fresh bounded observation (the user asked to retry the basemap). Counts and the one-way latch are cleared. */
  reset(): void {
    this.errors = 0;
    this.loads = 0;
    this.reported = false;
  }

  get unavailable(): boolean {
    return this.reported;
  }
}
