import { useI18n } from "../../i18n/I18nContext";

/**
 * Three local, self-contained SVG illustrations, one per evidence stage. They are flat, schematic drawings of a generic road
 * surface: not photographs, not a depiction of any real Mumbai street or event, and without any person, vehicle, plate,
 * house number or identifiable property. No external image, font or script is referenced.
 *
 * Which drawing is shown is chosen strictly from the committed evidence `stage`. Timestamps, captions, source type and
 * verification state are NOT part of the drawing; the page renders them from the API next to it. A fixture hash is never
 * presented as proof of authenticity.
 */
export type EvidenceStage = "BEFORE" | "CLAIMED_AFTER" | "DISPUTED_OR_RECURRING";

const ROAD = "#d9dde2";
const KERB = "#8896a5";
const INK = "#14283d";

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <>
      <rect x="0" y="0" width="320" height="180" fill="#f3f5f7" />
      <rect x="0" y="40" width="320" height="100" fill={ROAD} />
      <rect x="0" y="36" width="320" height="6" fill={KERB} />
      <rect x="0" y="138" width="320" height="6" fill={KERB} />
      <path d="M0 90 H320" stroke="#ffffff" strokeWidth="3" strokeDasharray="18 14" />
      {children}
      <rect x="0" y="150" width="320" height="30" fill="#ffffff" />
      <text x="160" y="170" textAnchor="middle" fontSize="12" fontFamily="system-ui, sans-serif" fill={INK}>
        {label}
      </text>
    </>
  );
}

export function BeforeIllustration({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <ellipse cx="150" cy="102" rx="46" ry="20" fill="#4b5563" />
      <ellipse cx="150" cy="100" rx="34" ry="13" fill="#2b3340" />
      <path d="M104 96 L84 84 M196 104 L222 112 M150 80 L156 62 M120 120 L108 134" stroke="#5b6b7b" strokeWidth="2" fill="none" />
    </Frame>
  );
}

export function ClaimedAfterIllustration({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <rect x="104" y="80" width="92" height="44" rx="4" fill="#9aa5b1" stroke="#5b6b7b" strokeWidth="2" strokeDasharray="6 4" />
      <path d="M110 102 H190" stroke="#c4ccd4" strokeWidth="2" />
    </Frame>
  );
}

export function DisputedIllustration({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <rect x="104" y="80" width="92" height="44" rx="4" fill="#9aa5b1" stroke="#5b6b7b" strokeWidth="2" strokeDasharray="6 4" />
      <ellipse cx="172" cy="104" rx="20" ry="9" fill="#4b5563" />
      <path d="M150 96 L134 84 M190 108 L212 118 M172 88 L176 72" stroke="#5b6b7b" strokeWidth="2" fill="none" />
      <circle cx="172" cy="104" r="30" fill="none" stroke={INK} strokeWidth="2" strokeDasharray="3 5" />
    </Frame>
  );
}

const DRAWINGS = {
  BEFORE: BeforeIllustration,
  CLAIMED_AFTER: ClaimedAfterIllustration,
  DISPUTED_OR_RECURRING: DisputedIllustration,
} as const;

export function EvidenceIllustration({ stage }: { stage: EvidenceStage }) {
  const { t } = useI18n();
  const Drawing = DRAWINGS[stage];
  const caption = t("p4.illustration.label");
  return (
    <svg
      className="evidence-illustration"
      role="img"
      viewBox="0 0 320 180"
      aria-labelledby={`ill-title-${stage}`}
      data-stage={stage}
      focusable="false"
    >
      <title id={`ill-title-${stage}`}>{`${caption}: ${t(`p4.evidence.stage.${stage}`)}`}</title>
      <Drawing label={caption} />
    </svg>
  );
}
