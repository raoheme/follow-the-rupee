/**
 * P5 strings for PAGE-04, PAGE-05 and PAGE-06. English is complete. Hindi and Marathi add nothing here, so every P5 string falls
 * back to English deterministically (findings P2-F05 and P3-F07 stay open: no native-speaker review has happened).
 * SYN-DEMO-* identifiers, INR text, route paths and server-supplied record text are never translated.
 */
export const enP5: Readonly<Record<string, string>> = {
  // shared
  "p5.syntheticNotice.title": "Practice environment",
  "p5.syntheticNotice.body":
    "This is a demonstration. Reports here are synthetic records, not complaints to the Brihanmumbai Municipal Corporation, and nothing you enter is sent to any authority.",
  "p5.pii.title": "Do not enter real personal data",
  "p5.pii.body":
    "Please do not type names, phone numbers, email addresses, home addresses, government identifiers, vehicle registration numbers, or faces or descriptions of identifiable people. Describe only the civic problem, in general terms.",
  "p5.steps.label": "Reporting steps",
  "p5.steps.report": "1. Report",
  "p5.steps.review": "2. Duplicate review",
  "p5.steps.receipt": "3. Receipt",
  "p5.back.map": "Back to map and list",
  "p5.open.kundali": "Open Kundali dossier",
  "p5.open.map": "Open map and list",
  "p5.new.report": "Report another issue",
  "p5.id.label": "Reference ID",
  "p5.status.label": "Status",
  "p5.error.retry": "Try again",
  "p5.loading.sr": "Working",

  // PAGE-04
  "p5.report.intro":
    "Describe a civic problem to see how this demonstration records a report and checks it against earlier synthetic reports. Submitting creates a synthetic record marked submitted and unverified; a duplicate check follows on the next page.",
  "p5.report.persona.ok": "Simulated persona: {persona}. This is a presentation lens, not a sign-in.",
  "p5.report.persona.blocked":
    "The selected persona ({persona}) cannot submit a report in this demonstration. Switch to Citizen in the header to continue. This is a simulated rule, not authentication.",
  "p5.report.summary.title": "Please fix these before submitting",
  "p5.report.summary.field": "Go to field",
  "p5.report.about.title": "About the problem",
  "p5.report.field.category": "Category",
  "p5.report.field.title": "Short title",
  "p5.report.field.description": "What is the problem?",
  "p5.report.field.landmark": "Nearby landmark (optional)",
  "p5.report.field.asset": "Affected road, drain or facility (optional)",
  "p5.report.field.longitude": "Longitude",
  "p5.report.field.latitude": "Latitude",
  "p5.report.hint.title": "Up to {max} characters.",
  "p5.report.hint.description": "Up to {max} characters. Describe only the problem, not people.",
  "p5.report.hint.landmark": "A general landmark label, up to {max} characters.",
  "p5.report.hint.asset": "Choose a synthetic asset if you know it. Leave as not sure otherwise.",
  "p5.report.hint.coords": "Decimal degrees, longitude first (GeoJSON order). Valid inside Greater Mumbai only.",
  "p5.report.category.choose": "Choose a category",
  "p5.report.asset.none": "Not sure / none",
  "p5.report.asset.loading": "Loading assets",
  "p5.report.asset.unavailable": "Assets could not be loaded. You can still submit without one.",
  "p5.report.counter": "{used} of {max} characters",
  "p5.report.location.title": "Where is it?",
  "p5.report.location.body":
    "Enter a position as coordinates. The online map is not needed to report. Your position is a synthetic point; it does not decide which authority is responsible.",
  "p5.report.location.demo": "Use the demonstration location near S.V. Road Junction",
  "p5.report.location.demoNote": "Fills the same position as the seeded Journey 2 report.",
  "p5.report.submit": "Submit report",
  "p5.report.submitting": "Submitting",
  "p5.report.error.required": "This field is required.",
  "p5.report.error.tooLong": "This is longer than the allowed length.",
  "p5.report.error.control": "Remove control characters; use plain text.",
  "p5.report.error.badNumber": "Enter a decimal number such as 72.83158.",
  "p5.report.error.outOfRange": "This position is outside Greater Mumbai, or longitude and latitude are swapped.",
  "p5.report.error.badAsset": "Choose one of the listed assets, or none.",
  "p5.report.error.badCategory": "Choose one of the listed categories.",
  "p5.report.failed.title": "The report was not submitted",
  "p5.report.failed.retryHint":
    "Nothing was lost. Trying again with the same text is safe: a repeated request returns the same synthetic record instead of creating a second one.",

  // PAGE-05
  "p5.dup.intro":
    "This page compares your synthetic report with earlier synthetic reports using a fixed rule set. It is a demonstration heuristic.",
  "p5.dup.method.title": "What this score is, and is not",
  "p5.dup.method.body":
    "The score is a deterministic demonstration heuristic (DEMONSTRATION_HEURISTIC_V1) built from five visible factors. It is not a probability, not an AI confidence, not a fraud or risk rating and not a legal conclusion. It does not merge, reject or delete any report. You decide what happens next.",
  "p5.dup.policy": "Policy label",
  "p5.dup.yourReport": "Your submitted report",
  "p5.dup.noRejection": "No report is silently rejected or merged by this check.",
  "p5.dup.empty.title": "No similar earlier reports were found",
  "p5.dup.empty.body":
    "The heuristic found no earlier synthetic report within the configured distance or on the same asset. Your report stays as submitted. Endorsing or adding evidence to an earlier report needs a candidate, so only keeping your report separate is available.",
  "p5.dup.candidates": "Earlier reports that may be the same problem",
  "p5.dup.score": "Score",
  "p5.dup.scoreOf": "{score} out of 100",
  "p5.dup.why": "Why this score",
  "p5.dup.points": "points",
  "p5.dup.recurrence": "Possible recurrence: this earlier report is marked verified complete. It would be linked as a recurrence, never merged.",
  "p5.dup.details.unavailable": "Details for this report could not be loaded; the identifier and score below are what the check returned.",
  "p5.dup.open": "Open this report's Kundali",
  "p5.dup.decide": "Your decision",
  "p5.dup.decide.body":
    "Choose one of the three paths. Each one records a synthetic evidence note (metadata only; no photo is uploaded).",
  "p5.dup.recovered":
    "This page was reopened, so your submitted report was read back from the server and the duplicate check was run again. The result is the same because it depends only on earlier records.",
  "p5.dup.noSubject.title": "No report to review",
  "p5.dup.noSubject.body":
    "PAGE-05 needs a report that has been submitted. Start from the report form, or open a report by its reference.",
  "p5.dup.badId.title": "That report reference is not valid",
  "p5.dup.badId.body": "The reference in the address is not a SYN-DEMO identifier, so nothing was requested.",
  "p5.dup.persona.blocked":
    "The duplicate check is a submission step, and the selected persona ({persona}) cannot run it in this demonstration. Switch to Citizen in the header and the check will run. This is a simulated rule, not authentication.",
  "p5.dup.check.failed": "The duplicate check could not be completed",
  "p5.dup.notReady":
    "The record version of this earlier report is not available, so it cannot be targeted from here.",
  "p5.dup.evidence.title": "Add a short synthetic note",
  "p5.dup.evidence.caption": "Your note (what you observed)",
  "p5.dup.evidence.captionHint": "Up to {max} characters. Describe only the civic problem, not people.",
  "p5.dup.evidence.fixture":
    "Evidence is recorded as a fixture reference only. No photo or file is read or uploaded, the hash covers the reference text and is not proof that anything is authentic, and nothing is verified.",
  "p5.dup.evidence.submit": "Record this decision",
  "p5.dup.evidence.cancel": "Cancel",
  "p5.dup.evidence.submitting": "Recording",
  "p5.dup.evidence.failed": "The decision was not recorded",
  "p5.dup.evidence.target": "Target report",
  "p5.dup.evidence.capture": "Your browser could not prepare the fixture reference (a secure context such as http://localhost is needed).",
  "p5.dup.skip": "Continue without a duplicate decision",
  "p5.dup.skip.body": "Your report stays submitted and unverified. No duplicate decision is recorded.",

  "p5.band.LIKELY_SAME": "Likely the same",
  "p5.band.POSSIBLE_MATCH": "Possible match",
  "p5.band.PROBABLY_DISTINCT": "Probably distinct",
  "p5.factor.sameAssetOrSegment": "Same road, drain or facility asset",
  "p5.factor.sameCategory": "Same category",
  "p5.factor.withinConfiguredRadius": "Within the configured distance for this category",
  "p5.factor.withinConfiguredWindow": "Reported within the configured time window",
  "p5.factor.keywordOverlap": "Words in common",
  "p5.choice.ENDORSE_EXISTING": "Endorse this report",
  "p5.choice.ADD_EVIDENCE_TO_EXISTING": "Add my evidence to this report",
  "p5.choice.CREATE_SEPARATE_ISSUE": "Keep my report separate",
  "p5.choice.ENDORSE_EXISTING.help": "Records that you also observe this problem, on the earlier report.",
  "p5.choice.ADD_EVIDENCE_TO_EXISTING.help": "Attaches your note to the earlier report as unverified evidence.",
  "p5.choice.CREATE_SEPARATE_ISSUE.help": "Treats your report as a different problem and records that decision on it.",
  "p5.caveat.claimed": "Closure is claimed but not verified. Silence does not verify it.",
  "p5.caveat.verified": "Marked verified complete in the demonstration records.",
  "p5.caveat.disputed": "Disputed or reopened.",
  "p5.caveat.unverified": "Submitted and not yet verified.",

  // PAGE-06
  "p5.receipt.intro": "A receipt for what this demonstration actually recorded. It is not an official acknowledgement.",
  "p5.receipt.notOfficial":
    "Not an official BMC submission or acknowledgement. No authority has accepted, triaged or verified this synthetic report.",
  "p5.receipt.states.title": "Where this report stands",
  "p5.receipt.state.submitted": "Submitted",
  "p5.receipt.state.unverified": "Unverified",
  "p5.receipt.state.linked": "Linked as a potential duplicate",
  "p5.receipt.state.separate": "Kept as a separate report",
  "p5.receipt.state.noDecision": "No duplicate decision recorded",
  "p5.receipt.state.verified": "Verified or resolved",
  "p5.receipt.state.yes": "Yes",
  "p5.receipt.state.no": "No",
  "p5.receipt.state.notReached": "Not reached",
  "p5.receipt.report": "Your submitted report",
  "p5.receipt.submittedAt": "Submitted (UTC)",
  "p5.receipt.nextState": "Next workflow state",
  "p5.receipt.nextState.body":
    "Submitted and unverified: waiting for triage by an authority. This demonstration does not triage reports in this step.",
  "p5.receipt.decision": "Duplicate decision",
  "p5.receipt.decision.target": "Recorded against report",
  "p5.receipt.decision.endorse": "You endorsed an earlier report. Your own report remains a separate, unverified record; nothing was merged.",
  "p5.receipt.decision.add": "You attached evidence to an earlier report. Your own report remains a separate, unverified record; nothing was merged.",
  "p5.receipt.decision.separate": "You kept your report separate. It was not merged with any earlier report.",
  "p5.receipt.decision.none": "No duplicate decision was recorded for this report.",
  "p5.receipt.evidence": "Evidence acknowledgment",
  "p5.receipt.evidence.state": "Evidence state",
  "p5.receipt.evidence.body": "Received as a synthetic fixture reference. It is in quarantine, not verified, and its location is unverified.",
  "p5.receipt.correlation": "Support references",
  "p5.receipt.correlation.submit": "Report",
  "p5.receipt.correlation.decision": "Decision",
  "p5.receipt.recovered.title": "Recovered from the server",
  "p5.receipt.recovered.body":
    "This page was reopened, so it was rebuilt from the records the server holds. Details that exist only in the original response (such as support references) are not shown.",
  "p5.receipt.recovered.decisionUnknown":
    "A duplicate decision is not shown because the server record does not identify one for this report.",
  "p5.receipt.missing.title": "No receipt to show",
  "p5.receipt.missing.body":
    "PAGE-06 shows what was recorded for a submitted report. Open it from the duplicate review, or start a new report.",
  "p5.receipt.badId.title": "A reference in the address is not valid",
  "p5.receipt.badId.body": "The address contains an identifier that is not a SYN-DEMO reference, so nothing was requested.",
  "p5.receipt.notFound.title": "That report was not found",
  "p5.receipt.notFound.body": "No synthetic record has that reference. It may have been cleared by a demonstration reset.",
};

export const hiP5: Readonly<Record<string, string>> = {};
export const mrP5: Readonly<Record<string, string>> = {};
