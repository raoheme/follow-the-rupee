/**
 * P6 strings for PAGE-08, PAGE-09 and PAGE-10. English is complete. Hindi and Marathi add nothing here, so every P6 string falls
 * back to English deterministically (findings P2-F05 and P3-F07 stay open: no native-speaker review has happened).
 * SYN-DEMO-* identifiers, INR text, route paths and server-supplied record text are never translated.
 *
 * Wording rules: institution, department and workflow post only (no person is named); spatial inference is provisional; a
 * jurisdiction step is a workflow record, not a legal determination; a defect liability period match is a potential warranty
 * path pending contractual verification, never liability and never a cost outcome.
 */
export const enP6: Readonly<Record<string, string>> = {
  // shared
  "p6.persona.blocked":
    "The selected persona ({persona}) is not part of the authority workflow in this demonstration, so no authority data is requested or shown. Switch to Authority in the header to continue. This is a simulated rule, not authentication.",
  "p6.row.titleUnavailable": "Title unavailable (issue list not loaded)",
  "p6.row.kundali": "Open Kundali",
  "p6.titles.failed.title": "Issue titles unavailable",
  "p6.titles.failed.body": "The public issue list could not be loaded, so rows show identifiers only. Queue contents are unaffected.",
  "p6.titles.partial.title": "Some titles are missing",
  "p6.titles.partial.body": "A listed identifier is not in the public issue list. Its row shows the identifier only; nothing is filled in.",
  "p6.form.summary": "Please fix these before submitting",
  "p6.form.working": "Working",
  "p6.stale.body":
    "The record changed, or the step is not allowed from its current state. Reload the record and review it before trying again. Nothing was changed by this attempt.",
  "p6.stale.reload": "Reload record",
  "p6.role.public": "Public",
  "p6.role.citizen": "Citizen",
  "p6.role.authority": "Authority workflow post",
  "p6.role.moderator": "Moderator",
  "p6.role.independent_reviewer": "Independent reviewer",
  "p6.role.demo_admin": "Demo administrator",
  "p6.role.system": "System",
  "p6.caveat.persona": "The persona is a simulated demonstration lens. It is not sign-in, identity or authorization.",
  "p6.caveat.jurisdiction":
    "Jurisdiction here is a workflow status in synthetic data. A spatial match is provisional evidence of proximity, never legal ownership.",
  "p6.caveat.osm": "Basemap and OpenStreetMap geometry never decide ownership. Proximity is not responsibility.",
  "p6.caveat.geographies":
    "Administrative ward, electoral geography, agency ownership and execution responsibility are different things; this page records none of them as a legal fact.",
  "p6.caveat.dlp":
    "A defect liability period match is a potential warranty path. Contractual applicability is pending verification; it is not a finding of liability, and no fresh-spend decision is made here.",
  "p6.caveat.institution": "Rows name institutions, departments and workflow posts, never individuals or contractors' conduct.",
  "p6.dlp.claimSafe":
    "Potential active DLP. Work certified on this asset may fall under a contractual rectification obligation, subject to confirmation of scope, dates, defect classification and contractual terms. Contractual applicability pending verification. This is not a finding of liability, and no fresh-spend decision has been made.",
  "p6.dlp.evaluated": "Evaluated at (UTC)",

  // PAGE-08
  "p6.authority.intro":
    "Queues for the simulated Authority workflow. Items that need a decision are separated from items shown for information. Every figure is read live from the demonstration API.",
  "p6.authority.summary": "Authority queue summary",
  "p6.authority.asOf": "As of {time}. Open issues: {open}.",
  "p6.authority.refresh": "Refresh",
  "p6.tile.jurisdiction": "Jurisdiction not confirmed",
  "p6.tile.dlp": "Potential active DLP exceptions",
  "p6.tile.verification": "Closure claims awaiting verification",
  "p6.tile.gaps": "Budget traceability gaps",
  "p6.kind.action": "Needs a decision",
  "p6.kind.info": "For information",
  "p6.group.action": "Needs a decision",
  "p6.group.info": "For information",
  "p6.queue.empty": "Nothing in this queue.",
  "p6.queue.jurisdiction.title": "Jurisdiction not yet confirmed",
  "p6.queue.jurisdiction.body":
    "Open issues whose jurisdiction is unknown, spatially inferred (provisional) or disputed. Each needs a simulated authority step; none is a legal determination.",
  "p6.queue.jurisdiction.action": "Review jurisdiction",
  "p6.queue.dlp.title": "Potential active DLP exceptions",
  "p6.queue.dlp.body": "Open issues not yet linked to a work order, on an asset whose certified work is inside its defect liability period.",
  "p6.queue.dlp.action": "Review linkage",
  "p6.queue.dlp.view": "DLP view",
  "p6.queue.verification.title": "Closure claims awaiting citizen verification",
  "p6.queue.verification.body":
    "A completion claim is not verification, and silence never verifies it. Verification steps belong to the citizen and to a later phase; this list is for information.",
  "p6.queue.gaps.title": "Budget traceability gaps",
  "p6.queue.gaps.body": "Budget lines whose chain to street-level geometry is incomplete. A gap is a missing link in the record, not a finding about anyone.",
  "p6.queue.gaps.note": "Missing link before street geometry",
  "p6.queue.gaps.action": "Open trace",
  "p6.authority.caveats": "What these queues do and do not mean",

  // PAGE-09
  "p6.juris.intro":
    "Review the provisional jurisdiction of a report, record a jurisdiction step or an external-agency handoff, and link an unlinked defect to a work order on the same asset. Each step is a simulated workflow record in synthetic data.",
  "p6.juris.choose": "Choose an issue",
  "p6.juris.backToCommand": "Back to authority queues",
  "p6.selector.title": "Choose an issue",
  "p6.selector.body": "Issues with an unconfirmed jurisdiction or a potential active DLP exception, from the authority queues.",
  "p6.selector.empty": "No issues are waiting in the authority queues.",
  "p6.selector.open": "Open",
  "p6.post.department": "Assigned department",
  "p6.post.workflow": "Workflow post",
  "p6.post.escalation": "Escalation post",
  "p6.jurisdiction.title": "Jurisdiction (workflow status)",
  "p6.jurisdiction.explain.UNKNOWN":
    "Jurisdiction unknown. No synthetic ward covers this location. This is not a legal determination.",
  "p6.jurisdiction.explain.SPATIALLY_INFERRED_PROVISIONAL":
    "Spatially inferred provisional jurisdiction. The location falls inside a candidate ward area on the synthetic map. This is provisional evidence of proximity, not legal ownership.",
  "p6.jurisdiction.explain.CONFIRMED_BMC_WARD":
    "Confirmed as a BMC ward in this demonstration by a simulated authority step. This is not a legal determination of ownership.",
  "p6.jurisdiction.explain.EXTERNAL_AGENCY_ASSIGNED":
    "Assigned to an external agency in this demonstration. The handoff has not been recorded yet.",
  "p6.jurisdiction.explain.CONFLICT_DISPUTED":
    "Jurisdiction disputed. Sources disagree about whether this belongs to the ward or to another agency; a simulated authority step must resolve it.",
  "p6.jurisdiction.explain.HANDOFF_LOGGED":
    "External-agency handoff recorded. This is a workflow record, not a legal finding.",
  "p6.jurisdiction.provisionalNote":
    "Until an authority step resolves it, this stays provisional. Map proximity and basemap lines are never treated as ownership.",
  "p6.jurisdiction.ward": "Candidate ward",
  "p6.jurisdiction.noWard": "No candidate ward",
  "p6.jurisdiction.method": "Spatial match",
  "p6.jurisdiction.method.ST_COVERS": "Point inside a synthetic candidate area",
  "p6.jurisdiction.method.ST_INTERSECTS": "Shape touches a synthetic candidate area",
  "p6.jurisdiction.method.NONE": "No spatial match",
  "p6.jurisdiction.distance": "{metres} m from the synthetic boundary",
  "p6.jurisdiction.agency": "External agency (label)",
  "p6.jurisdiction.basis": "Confirmation basis",
  "p6.jurisdiction.legal": "Legal ownership asserted",
  "p6.jurisdiction.legalNo": "No",
  "p6.jurisdiction.version": "Record version",
  "p6.jurisdiction.conflict": "Source conflict recorded",
  "p6.jurisdiction.conflictHistorical": "This note was recorded before the latest step and is kept as history.",
  "p6.jurisdiction.caveats": "Caveats",
  "p6.resolve.title": "Record a jurisdiction step",
  "p6.resolve.intro":
    "Only the steps the committed workflow allows from the current state are offered. The step is recorded with the previous and new state and your rationale in the audit trail.",
  "p6.resolve.done": "Recorded.",
  "p6.resolve.doneBody": "Jurisdiction is now: {state} (record version {version}).",
  "p6.resolve.final.UNKNOWN": "No step can be recorded from an unknown jurisdiction in this workflow.",
  "p6.resolve.final.CONFIRMED_BMC_WARD": "This jurisdiction is confirmed as a BMC ward in this demonstration. No further step is available.",
  "p6.resolve.final.HANDOFF_LOGGED": "External-agency handoff recorded. No further step is available.",
  "p6.resolve.target": "Step to record",
  "p6.resolve.target.CONFIRMED_BMC_WARD": "Confirm as BMC ward",
  "p6.resolve.target.CONFIRMED_BMC_WARD.hint": "Records a ward confirmation in demonstration data. Not a legal determination.",
  "p6.resolve.target.EXTERNAL_AGENCY_ASSIGNED": "Assign to an external agency",
  "p6.resolve.target.EXTERNAL_AGENCY_ASSIGNED.hint": "Names the agency the issue is expected to belong to. The handoff is recorded as a separate step.",
  "p6.resolve.target.HANDOFF_LOGGED": "Record the external-agency handoff",
  "p6.resolve.target.HANDOFF_LOGGED.hint": "Records that the handoff to the assigned agency took place.",
  "p6.resolve.agency": "External agency label",
  "p6.resolve.agency.handoff": "External agency label (leave empty to keep the assigned agency)",
  "p6.resolve.agency.hint": "Up to {max} characters. Use a generic label, not a person.",
  "p6.resolve.rationale": "Rationale",
  "p6.resolve.rationale.hint":
    "State the institutional basis in neutral words. Do not name or accuse a person or a contractor. Do not enter personal data.",
  "p6.resolve.counter": "{used} of {max} characters",
  "p6.resolve.disclaimer":
    "Recorded in the append-only audit trail of this synthetic record. It is a simulated workflow step, not a legal determination and not an instruction to any real authority.",
  "p6.resolve.submit": "Record step",
  "p6.resolve.error.target": "Choose one of the offered steps.",
  "p6.resolve.error.labelRequired": "Enter the external agency label.",
  "p6.resolve.error.labelInvalid": "The agency label must be 1 to 160 characters without control characters.",
  "p6.resolve.error.labelNotAllowed": "A ward confirmation carries no agency label. Clear the field.",
  "p6.resolve.error.rationaleRequired": "Enter a rationale.",
  "p6.resolve.error.rationaleInvalid": "The rationale must be 1 to 400 characters without control characters.",
  "p6.link.title": "Work linkage",
  "p6.link.intro":
    "Linking records a relationship between this issue and a work order on the same asset. It is not a finding of liability, contractual applicability or any cost outcome.",
  "p6.link.linkedBadge": "Linked to a work order",
  "p6.link.work": "Work order",
  "p6.link.workStatus": "Work status",
  "p6.link.dlpEnds": "DLP ends (UTC)",
  "p6.link.neverReplaced": "An existing link is never replaced from this page, and earlier history is kept.",
  "p6.link.openTrace": "Open work and budget trace",
  "p6.link.noAsset.title": "No asset named",
  "p6.link.noAsset.body": "This issue does not name an asset, so it cannot be linked to a work order.",
  "p6.link.unlinked": "This issue is not linked to a work order. It is on the asset: {asset}.",
  "p6.link.noCandidate": "No active DLP candidate was found for this issue. You may still link a work order on the same asset.",
  "p6.link.candidateNote": "A candidate from the DLP exception queue. Selecting it does not link anything.",
  "p6.link.field.work": "Work order identifier",
  "p6.link.field.work.hint": "A SYN-DEMO work order on the same asset, for example the candidate shown above.",
  "p6.link.useCandidate": "Use candidate {id}",
  "p6.link.done": "Linked.",
  "p6.link.doneBody": "Work order {work} is now linked (issue record version {version}).",
  "p6.link.disclaimer":
    "Recorded in the append-only audit trail of this synthetic record. The defect liability period is derived when read and is not stored or decided here.",
  "p6.link.submit": "Link work order",
  "p6.link.error.workOrderId": "Enter a work order identifier that starts with SYN-DEMO-.",
  "p6.link.error.rationaleRequired": "Enter a rationale.",
  "p6.link.error.rationaleInvalid": "The rationale must be 1 to 400 characters without control characters.",
  "p6.work.status.BUDGETED_PROPOSED": "Budgeted, proposed",
  "p6.work.status.TENDER_PUBLISHED": "Tender published",
  "p6.work.status.RETENDER_REQUIRED": "Retender required",
  "p6.work.status.CONTRACT_AWARDED": "Contract awarded",
  "p6.work.status.WORK_ORDER_ISSUED": "Work order issued",
  "p6.work.status.IN_EXECUTION": "In execution",
  "p6.work.status.SUSPENDED": "Suspended",
  "p6.work.status.COMPLETION_CERTIFIED_IN_DLP": "Completion certified, in DLP",
  "p6.work.status.DEFECT_NOTIFIED": "Defect notified",
  "p6.work.status.DLP_EXPIRED_ARCHIVED": "DLP expired, archived",
  "p6.audit.title": "Recent audit trail",
  "p6.audit.note": "Append-only and hash-linked in this demonstration. Not a claim of tamper-proof storage.",
  "p6.audit.none": "No audit events.",
  "p6.audit.older": "Earlier events ({count})",

  // PAGE-10
  "p6.dlp.intro":
    "Open issues that are not linked to a work order, on an asset whose certified work is inside its defect liability period at the time this page was read. The match is temporal; contractual applicability still needs verification.",
  "p6.dlp.list.title": "Potential active DLP exceptions",
  "p6.dlp.empty.title": "No exceptions at this time",
  "p6.dlp.empty.body": "No unlinked open issue overlaps an active defect liability period at the evaluation time.",
  "p6.dlp.candidate": "Candidate work order",
  "p6.dlp.window": "DLP window",
  "p6.dlp.estimate": "Synthetic fresh-repair estimate",
  "p6.dlp.potentialLabel": "synthetic potential, not realized savings",
  "p6.dlp.details": "Warranty path and caveats",
  "p6.dlp.noFreshSpend": "No fresh-spend decision made. The estimate is synthetic and nothing here claims a saving or a zero municipal cost.",
  "p6.dlp.review": "Review linkage",
  "p6.completion.title": "Completion claims",
  "p6.completion.notice": "Not part of this phase",
  "p6.completion.body":
    "Completion claims and citizen verification belong to a later phase. Nothing here is shown as completed or verified, and a claim would never count as verification.",
};
