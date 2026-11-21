import { HeroStrip, MapTriage } from "./MapTriage";

export function MapPage() {
  return (
    <div className="m-page m-page--wide">
      <h1 id="page-heading" tabIndex={-1} className="m-h1">
        Map Triage
      </h1>
      <HeroStrip />
      <MapTriage />
    </div>
  );
}
