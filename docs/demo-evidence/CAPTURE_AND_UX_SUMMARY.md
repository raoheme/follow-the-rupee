# Browser capture and cold-judge readability summary

Run date: 2026-11-21 · App commit: `c8fb7112` (branch `hackathon/follow-the-rupee`) · Chromium (Playwright 1.55), viewport 1600×900,
live stack (`/health/capabilities`: `monsoonReads=AVAILABLE`, `commands=DISABLED`). Read-only; no repository file was changed.
Synthetic challenge dataset; not official BMC data.

## Automated checks across the five views (Map Triage, Repair Auditor, Scorecards, Next-Rupee Planner, Trail Kundali)

| Check | Result |
|---|---|
| Browser console errors | 0 |
| Uncaught page errors | 0 |
| Failed or non-2xx local API/UI requests | 0 |
| Horizontal overflow at 1600×900 | 0 (all 5 views, all captured states) |
| Forbidden claim words in rendered text (`fraud`, `corruption`, `ghost work order`, `wasted money`, `overbilled`, `overcharged`, `contractor failure`, `cash cost ₹0`, `16,900,231`, `8.03M`) | 0 hits |
| "confirmed loss" appears only inside the sentence *"Categories overlap and are not an estimate of confirmed loss."* | Yes (0 occurrences outside it) |

The figures above are from the first full recording pass (all 7 clips). A later re-recording pass, run while the same machine was
rendering video, logged 4 transient console errors (HTTP 503 responses) on two clips and timed out twice on two others; that
pass is not the one summarised here, and the application itself was unchanged between the passes. The raw `.webm` clips and
their manifest are working files for the demo video and are not part of this repository.

## Cold-judge readability (honest YES/NO)

| # | Question | Answer | Notes |
|---|---|---|---|
| 1 | Synthetic challenge dataset disclosure visible on landing? | **YES** | Top banner: "Synthetic Challenge Dataset (Not Official BMC Data)"; fuller text in the "Methodology & AI Disclosure" panel. |
| 2 | "Defect Liability Period" spelled out alongside "DLP"? | **NO (partial)** | Spelled out only in the Planner's New Budget lane note ("Roads not under a defect liability period"). Map, Auditor, DLP Review First lane and Kundali show the abbreviation only. The README defines it. |
| 3 | GPS vs locality-centroid legend and unresolved-not-pinned wording visible? | **YES** | Ward F/S: legend "Source GPS (solid)" / "Locality centroid (coarse, not exact GPS) (hollow, dashed)"; "Unresolved coordinates (0) are counted, never pinned." |
| 4 | Overlap caveat verbatim on the Auditor? | **YES** | "Categories overlap and are not an estimate of confirmed loss." (also under the Auditor's row count). |
| 5 | Zero A–D contractor letter grades; Methodology collapsed by default? | **YES** | 8 contractor cards, no letter grades, "Methodology & Sensitivity" closed before and after scrolling. |
| 6 | Ward rank and citywide lane rank visible on the Planner; budget → ₹0 flips affordability without changing rank? | **YES** | All 25 New Budget candidates show "#N in Ward X" and "#N in Mumbai". Before: 21 "Affordable now: Yes", 4 "No". After budget ₹0: 0 Yes, 25 No. Road order, risk scores and rank badges identical. |

Other observed facts: Map landing shows ₹13.43 Cr of ₹14.91 Cr spent, 433 findings across 415 unique work orders; ward F/S shows
"Showing 183 of 183 issues"; the Auditor shows ₹60.66 lakh, ₹25.91 lakh and ₹87.29 lakh as three separate cards and ₹2.18 Cr unique
billed value touched; the 8 Claude-authored contractor briefs are 95–108 words each (all under 120); `RD0220` is #1 in Ward L and #1
in Mumbai in the DLP Review First lane and shows no ₹0 cost claim.

## Differences from what a reader might assume

* The Planner's what-if budget is a **range slider**, not a text box; it was set to ₹0 with the keyboard (Home key).
* The Planner's evidence button reads **"Inspect Evidence"** (it opens the Evidence Drawer); the Map's marker button reads "Open evidence".
* On the Auditor the three cards, the ₹2.18 Cr summary line and the shields fit one screen; the "Download Audit CSV" button sits just below and needs a short scroll.
* The ward-F/S map showed **0** unresolved coordinates, so the "never pinned" sentence reads "(0)" there.
