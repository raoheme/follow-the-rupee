# H0 Report — Follow the Rupee: Mumbai Monsoon Roads

> Synthetic challenge dataset. Not official BMC data. Contractors, amounts, dates, coordinates and transactions are fictional. Real Mumbai geographic names are used only for challenge realism.

- Source repo: https://github.com/SumeetGDoshi/Claude-Impact-Labs-data-2
- Invocation: `python -X utf8 pipeline/00_eda.py` (forensic EDA) then `python -X utf8 pipeline/00a_h0_report.py` (this report). Do not use `-I` (hides user-site packages).
- Git baseline: `main` = `e456b87`, `wip/p7-paused` = `17c22717`, active branch `hackathon/follow-the-rupee`. P7/P8/validate_package.py are not run on this branch; database `civic_lens` is untouched.

## 1. Source inventory (17 files, read-only, never copied into git)

| file | rows/features | SHA-256 |
|---|---:|---|
| accidents.csv | 420 | `8f9c5086e4e54c20e606ad235722071f5f3694cc86565039b92cd22ef5864020` |
| complaints.csv | 6501 | `c601cf729cd941b8ff00959aec5a0cf3d75bba8aec89453dfec8a19e89ab05b7` |
| complaints_sample_200.csv | 200 | `fa0087fc7b7a50d84d655ecea52e85250a8d17dad5cc1ed7d1067d70f746f352` |
| contractors.csv | 8 | `fdc60c6117cc278981234733bb30a96063b8338443e3810f9207eccae413a69d` |
| facilities.csv | 160 | `64e5e9f970e81b5e688d572d64c39828de88e0431d698ec6238b5c90e157071f` |
| flood_hotspots.csv | 28 | `ba278bbe703c3f4f1a5682c9fca1f29ee94616bbb2bd07beb0478abdf1887391` |
| localities.csv | 118 | `cb3d4f3ee1ad85901c29a3fdc68b552f30b883e4b888a8d60040d3b28f0182ec` |
| rainfall_daily.csv | 244 | `95389e0ed0766766f4c3b52a72784eb7cf020626322ea508397d5fe21d1c25b4` |
| rate_card.csv | 10 | `8cfc42992d0215897d2496eb547b52cb921c6a67c6e1277f35910c8b2962cd48` |
| roads.csv | 291 | `9a166faa45f5ba2d26bb0754340974458fef0be0cf85eb55b7ecfab4bd45496c` |
| roads.geojson | 291 | `1d8421ace53b092021c4700cf228a82bb2e60963deae5fa8d814cc0b9d7ab67d` |
| social_posts.csv | 650 | `b97f42db933e84ab274ce66c99bfffc9c0a325947be1fdc896d446a5f46b7162` |
| tides.csv | 244 | `35c15a1101db137eb18b43b7adf4ec1fcc2950cc6972643e1a9e00303e5708b5` |
| traffic.csv | 291 | `58242ca0a819031e9201846d51572996211b0f0037ba380232d242150c671fc3` |
| wards.csv | 24 | `c8eae5cd55e7e523aab73c22dbdcab32b873a334a127e99a008cd71825c2b179` |
| wards.geojson | 24 | `611061c54e0859e0f65c01ee9a441254d34aa976397d54b0607e46a69ebd76fb` |
| work_orders.csv | 2499 | `3db51c1d2759da8b2c18121d740a82b75ced881f72263568f3335d2ea2f613ee` |

## 2. Rate-card reconciliation (113 vs 123 contradiction)

Valid work orders: **2499** (unmatched repair_method: 0; null/zero area or cost: 0). expected = area_sqm × rate (per sqm) or rate (per job); ratio = cost_inr / expected.

| ratio ≥ | n | billed ₹ | expected ₹ | positive excess ₹ | contractors (id:n) | repair methods (n) |
|---:|---:|---:|---:|---:|---|---|
| 1.30 | 114 | 11,365,414 | 5,299,100 | 6,066,314 | CT03:44, CT07:38, CT08:10, CT06:5, CT04:5, CT02:5, CT05:4, CT01:3 | Cold mix patch 30; Mastic asphalt 16; Desilting and garbage removal 14; Manhole cover replaced + grating 12; Drain desilting 12; Hot mix patch 12; Pump + debris removal 7; Dewatering pump deployed 6; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.35 | 113 | 11,334,460 | 5,275,580 | 6,058,880 | CT03:44, CT07:38, CT08:10, CT04:5, CT02:5, CT06:4, CT05:4, CT01:3 | Cold mix patch 30; Mastic asphalt 15; Desilting and garbage removal 14; Manhole cover replaced + grating 12; Drain desilting 12; Hot mix patch 12; Pump + debris removal 7; Dewatering pump deployed 6; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.40 | 111 | 11,260,851 | 5,221,400 | 6,039,451 | CT03:43, CT07:37, CT08:10, CT04:5, CT02:5, CT06:4, CT05:4, CT01:3 | Cold mix patch 29; Mastic asphalt 15; Desilting and garbage removal 14; Drain desilting 12; Hot mix patch 12; Manhole cover replaced + grating 11; Pump + debris removal 7; Dewatering pump deployed 6; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.45 | 111 | 11,260,851 | 5,221,400 | 6,039,451 | CT03:43, CT07:37, CT08:10, CT04:5, CT02:5, CT06:4, CT05:4, CT01:3 | Cold mix patch 29; Mastic asphalt 15; Desilting and garbage removal 14; Drain desilting 12; Hot mix patch 12; Manhole cover replaced + grating 11; Pump + debris removal 7; Dewatering pump deployed 6; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.50 | 109 | 11,180,344 | 5,166,320 | 6,014,024 | CT03:42, CT07:37, CT08:10, CT04:5, CT02:5, CT05:4, CT06:3, CT01:3 | Cold mix patch 29; Mastic asphalt 14; Desilting and garbage removal 14; Drain desilting 12; Hot mix patch 12; Manhole cover replaced + grating 10; Pump + debris removal 7; Dewatering pump deployed 6; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.55 | 109 | 11,180,344 | 5,166,320 | 6,014,024 | CT03:42, CT07:37, CT08:10, CT04:5, CT02:5, CT05:4, CT06:3, CT01:3 | Cold mix patch 29; Mastic asphalt 14; Desilting and garbage removal 14; Drain desilting 12; Hot mix patch 12; Manhole cover replaced + grating 10; Pump + debris removal 7; Dewatering pump deployed 6; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.60 | 104 | 10,667,193 | 4,840,200 | 5,826,993 | CT03:40, CT07:36, CT08:10, CT02:5, CT05:4, CT04:4, CT01:3, CT06:2 | Cold mix patch 29; Mastic asphalt 14; Desilting and garbage removal 13; Hot mix patch 11; Drain desilting 10; Manhole cover replaced + grating 10; Pump + debris removal 7; Dewatering pump deployed 5; Excavation, pipeline repair, PQC patch 3; Paver blocks relaid 2 |
| 1.80 | 82 | 8,643,904 | 3,659,040 | 4,984,864 | CT03:35, CT07:25, CT08:8, CT04:4, CT05:3, CT02:3, CT06:2, CT01:2 | Cold mix patch 22; Desilting and garbage removal 12; Hot mix patch 11; Mastic asphalt 9; Drain desilting 8; Manhole cover replaced + grating 8; Dewatering pump deployed 5; Pump + debris removal 3; Excavation, pipeline repair, PQC patch 2; Paver blocks relaid 2 |
| 2.00 | 64 | 7,446,404 | 3,032,760 | 4,413,644 | CT03:27, CT07:16, CT08:7, CT04:4, CT05:3, CT02:3, CT06:2, CT01:2 | Cold mix patch 14; Desilting and garbage removal 12; Mastic asphalt 9; Hot mix patch 8; Drain desilting 6; Manhole cover replaced + grating 6; Dewatering pump deployed 3; Excavation, pipeline repair, PQC patch 2; Pump + debris removal 2; Paver blocks relaid 2 |

**Resolution.** `123` is not reproducible from the supplied files; the exact counts are above (≥1.30: 114; ≥1.35: 113). 113 was the ≥1.35 count in the first EDA; 114 includes WO25-02490 (1.3161).

**Locked `rate_card_overbill_threshold` = strictly > 1.30** (`pipeline/config/audit_rules.json`). Evidence: the documented normal variance is 20–30% around the rate; all 2385 jobs ≤ 1.30 have max ratio 1.2997 (flat 0.75–1.30 band, ~230 jobs per 0.05 step); above 1.30 there are only 5 jobs in the valley 1.30–1.55 (WO25-02490, WO25-01389, WO25-00405, WO25-00018, WO25-00045) against 109 jobs ≥ 1.55. These 5 are flagged but marked `in_valley=true`. Sensitivity: 114 (>1.30) → 111 (≥1.40) → 109 (≥1.50/1.55) → 104 (≥1.60) → 64 (≥2.00); contractor concentration (CT03 Mahalaxmi, CT07 Arabian Sea) is unchanged at every threshold.

### Every work order with 1.25 ≤ ratio < 1.65 (ascending)

262 work orders. Columns: WO | contractor | method | expected ₹ | billed ₹ | ratio.

| WO | ctr | method | expected | billed | ratio |
|---|---|---|---:|---:|---:|
| WO25-02160 | CT08 | Desilting and garbage removal | 70,000 | 87,510 | 1.2501 |
| WO25-01761 | CT04 | Mastic asphalt | 37,380 | 46,733 | 1.2502 |
| WO25-00481 | CT02 | Cold mix patch | 20,700 | 25,881 | 1.2503 |
| WO25-00150 | CT05 | Pump + debris removal | 110,000 | 137,549 | 1.2504 |
| WO25-00834 | CT01 | Cold mix patch | 21,420 | 26,788 | 1.2506 |
| WO25-01616 | CT04 | Desilting and garbage removal | 70,000 | 87,548 | 1.2507 |
| WO25-01053 | CT03 | Cold mix patch | 17,100 | 21,388 | 1.2508 |
| WO25-00261 | CT01 | Cold mix patch | 20,880 | 26,123 | 1.2511 |
| WO25-01886 | CT07 | Manhole cover replaced + grating | 45,000 | 56,300 | 1.2511 |
| WO25-02241 | CT08 | Mastic asphalt | 49,560 | 62,022 | 1.2515 |
| WO25-01757 | CT01 | Mastic asphalt | 20,580 | 25,755 | 1.2515 |
| WO25-01879 | CT05 | Manhole cover replaced + grating | 45,000 | 56,321 | 1.2516 |
| WO25-01819 | CT07 | Hot mix patch | 30,680 | 38,399 | 1.2516 |
| WO25-00959 | CT06 | Desilting and garbage removal | 70,000 | 87,624 | 1.2518 |
| WO25-01190 | CT04 | Mastic asphalt | 28,560 | 35,751 | 1.2518 |
| WO25-02076 | CT01 | Cold mix patch | 18,720 | 23,434 | 1.2518 |
| WO25-01944 | CT06 | Excavation, pipeline repair, PQC patch | 180,000 | 225,335 | 1.2519 |
| WO25-01104 | CT01 | Desilting and garbage removal | 70,000 | 87,637 | 1.2520 |
| WO25-00487 | CT06 | Paver blocks relaid | 92,100 | 115,324 | 1.2522 |
| WO25-01984 | CT07 | Dewatering pump deployed | 60,000 | 75,149 | 1.2525 |
| WO25-02053 | CT05 | Desilting and garbage removal | 70,000 | 87,680 | 1.2526 |
| WO25-02123 | CT01 | Mastic asphalt | 6,300 | 7,892 | 1.2527 |
| WO25-00071 | CT08 | Excavation, pipeline repair, PQC patch | 180,000 | 225,541 | 1.2530 |
| WO25-00847 | CT05 | Manhole cover replaced + grating | 45,000 | 56,386 | 1.2530 |
| WO25-02297 | CT05 | Dewatering pump deployed | 60,000 | 75,208 | 1.2535 |
| WO25-01143 | CT02 | Cold mix patch | 5,220 | 6,544 | 1.2536 |
| WO25-00386 | CT06 | Pump + debris removal | 110,000 | 137,908 | 1.2537 |
| WO25-01501 | CT06 | Mastic asphalt | 23,520 | 29,489 | 1.2538 |
| WO25-01788 | CT08 | Pump + debris removal | 110,000 | 137,941 | 1.2540 |
| WO25-02343 | CT06 | Cold mix patch | 14,220 | 17,833 | 1.2541 |
| WO25-01367 | CT02 | Dewatering pump deployed | 60,000 | 75,251 | 1.2542 |
| WO25-01418 | CT08 | Mastic asphalt | 10,920 | 13,697 | 1.2543 |
| WO25-00573 | CT01 | Drain desilting | 90,000 | 112,893 | 1.2544 |
| WO25-01625 | CT02 | Excavation, pipeline repair, PQC patch | 180,000 | 225,792 | 1.2544 |
| WO25-02201 | CT07 | Cold mix patch | 17,100 | 21,457 | 1.2548 |
| WO25-02102 | CT08 | Manhole cover replaced + grating | 45,000 | 56,480 | 1.2551 |
| WO25-00317 | CT02 | Cold mix patch | 6,480 | 8,135 | 1.2554 |
| WO25-01428 | CT01 | Pump + debris removal | 110,000 | 138,147 | 1.2559 |
| WO25-01783 | CT03 | Cold mix patch | 7,379 | 9,269 | 1.2560 |
| WO25-00185 | CT03 | Mastic asphalt | 47,880 | 60,140 | 1.2561 |
| WO25-01279 | CT07 | Drain desilting | 90,000 | 113,057 | 1.2562 |
| WO25-01073 | CT04 | Hot mix patch | 22,360 | 28,098 | 1.2566 |
| WO25-00535 | CT02 | Mastic asphalt | 19,320 | 24,279 | 1.2567 |
| WO25-01834 | CT08 | Desilting and garbage removal | 70,000 | 88,017 | 1.2574 |
| WO25-01215 | CT01 | Cold mix patch | 13,680 | 17,203 | 1.2575 |
| WO25-02386 | CT01 | Cold mix patch | 21,240 | 26,722 | 1.2581 |
| WO25-00226 | CT01 | Dewatering pump deployed | 60,000 | 75,511 | 1.2585 |
| WO25-01149 | CT05 | Pump + debris removal | 110,000 | 138,498 | 1.2591 |
| WO25-02411 | CT05 | Mastic asphalt | 15,540 | 19,566 | 1.2591 |
| WO25-01350 | CT05 | Cold mix patch | 13,320 | 16,778 | 1.2596 |
| WO25-01803 | CT04 | Cold mix patch | 6,120 | 7,709 | 1.2596 |
| WO25-00811 | CT02 | Cold mix patch | 3,420 | 4,308 | 1.2596 |
| WO25-00081 | CT01 | Cold mix patch | 18,180 | 22,910 | 1.2602 |
| WO25-01595 | CT02 | Hot mix patch | 30,160 | 38,008 | 1.2602 |
| WO25-02476 | CT08 | Dewatering pump deployed | 60,000 | 75,619 | 1.2603 |
| WO25-00234 | CT08 | Hot mix patch | 9,360 | 11,798 | 1.2605 |
| WO25-00991 | CT08 | Excavation, pipeline repair, PQC patch | 180,000 | 226,907 | 1.2606 |
| WO25-01337 | CT02 | Cold mix patch | 15,480 | 19,516 | 1.2607 |
| WO25-02290 | CT05 | Manhole cover replaced + grating | 45,000 | 56,735 | 1.2608 |
| WO25-02084 | CT06 | Cold mix patch | 3,240 | 4,086 | 1.2611 |
| WO25-01781 | CT07 | Cold mix patch | 18,180 | 22,927 | 1.2611 |
| WO25-00403 | CT02 | Mastic asphalt | 15,540 | 19,601 | 1.2613 |
| WO25-01010 | CT04 | Dewatering pump deployed | 60,000 | 75,681 | 1.2613 |
| WO25-02283 | CT08 | Hot mix patch | 9,360 | 11,809 | 1.2616 |
| WO25-01738 | CT03 | Cold mix patch | 1,620 | 2,044 | 1.2617 |
| WO25-00319 | CT07 | Excavation, pipeline repair, PQC patch | 180,000 | 227,184 | 1.2621 |
| WO25-00862 | CT03 | Mastic asphalt | 4,200 | 5,302 | 1.2624 |
| WO25-01743 | CT06 | Cold mix patch | 3,060 | 3,863 | 1.2624 |
| WO25-01582 | CT04 | Cold mix patch | 7,740 | 9,772 | 1.2625 |
| WO25-02333 | CT04 | Pump + debris removal | 110,000 | 138,879 | 1.2625 |
| WO25-01939 | CT07 | Mastic asphalt | 45,360 | 57,279 | 1.2628 |
| WO25-02169 | CT02 | Dewatering pump deployed | 60,000 | 75,767 | 1.2628 |
| WO25-00837 | CT01 | Dewatering pump deployed | 60,000 | 75,782 | 1.2630 |
| WO25-01816 | CT08 | Desilting and garbage removal | 70,000 | 88,461 | 1.2637 |
| WO25-02178 | CT01 | Hot mix patch | 7,020 | 8,872 | 1.2638 |
| WO25-00008 | CT04 | Desilting and garbage removal | 70,000 | 88,502 | 1.2643 |
| WO25-02417 | CT07 | Drain desilting | 90,000 | 113,793 | 1.2644 |
| WO25-02227 | CT04 | Excavation, pipeline repair, PQC patch | 180,000 | 227,589 | 1.2644 |
| WO25-01760 | CT07 | Desilting and garbage removal | 70,000 | 88,531 | 1.2647 |
| WO25-01415 | CT02 | Mastic asphalt | 4,200 | 5,312 | 1.2648 |
| WO25-01839 | CT06 | Hot mix patch | 29,900 | 37,825 | 1.2651 |
| WO25-02113 | CT03 | Mastic asphalt | 42,840 | 54,198 | 1.2651 |
| WO25-01558 | CT04 | Mastic asphalt | 9,240 | 11,692 | 1.2654 |
| WO25-01880 | CT06 | Hot mix patch | 6,240 | 7,897 | 1.2655 |
| WO25-00916 | CT02 | Hot mix patch | 25,219 | 31,931 | 1.2661 |
| WO25-01693 | CT06 | Cold mix patch | 1,800 | 2,279 | 1.2661 |
| WO25-00324 | CT04 | Hot mix patch | 16,900 | 21,406 | 1.2666 |
| WO25-00006 | CT07 | Hot mix patch | 18,720 | 23,727 | 1.2675 |
| WO25-02492 | CT08 | Desilting and garbage removal | 70,000 | 88,774 | 1.2682 |
| WO25-00623 | CT02 | Drain desilting | 90,000 | 114,145 | 1.2683 |
| WO25-01734 | CT07 | Pump + debris removal | 110,000 | 139,511 | 1.2683 |
| WO25-02094 | CT04 | Excavation, pipeline repair, PQC patch | 180,000 | 228,332 | 1.2685 |
| WO25-02232 | CT04 | Cold mix patch | 1,080 | 1,370 | 1.2685 |
| WO25-00607 | CT08 | Mastic asphalt | 11,760 | 14,922 | 1.2689 |
| WO25-01959 | CT04 | Paver blocks relaid | 59,400 | 75,373 | 1.2689 |
| WO25-00344 | CT06 | Mastic asphalt | 48,720 | 61,859 | 1.2697 |
| WO25-01049 | CT06 | Dewatering pump deployed | 60,000 | 76,201 | 1.2700 |
| WO25-01385 | CT08 | Hot mix patch | 10,400 | 13,210 | 1.2702 |
| WO25-01500 | CT08 | Pump + debris removal | 110,000 | 139,752 | 1.2705 |
| WO25-02414 | CT02 | Mastic asphalt | 36,960 | 46,965 | 1.2707 |
| WO25-02018 | CT04 | Paver blocks relaid | 13,799 | 17,538 | 1.2709 |
| WO25-01224 | CT07 | Drain desilting | 90,000 | 114,395 | 1.2711 |
| WO25-02228 | CT03 | Cold mix patch | 18,000 | 22,881 | 1.2712 |
| WO25-00181 | CT02 | Mastic asphalt | 49,980 | 63,533 | 1.2712 |
| WO25-02082 | CT06 | Dewatering pump deployed | 60,000 | 76,271 | 1.2712 |
| WO25-01820 | CT06 | Desilting and garbage removal | 70,000 | 89,016 | 1.2717 |
| WO25-02347 | CT01 | Cold mix patch | 8,460 | 10,760 | 1.2719 |
| WO25-00717 | CT01 | Pump + debris removal | 110,000 | 139,911 | 1.2719 |
| WO25-01804 | CT01 | Mastic asphalt | 21,000 | 26,711 | 1.2720 |
| WO25-01640 | CT02 | Desilting and garbage removal | 70,000 | 89,040 | 1.2720 |
| WO25-01330 | CT02 | Hot mix patch | 15,080 | 19,183 | 1.2721 |
| WO25-01414 | CT05 | Cold mix patch | 20,700 | 26,337 | 1.2723 |
| WO25-00463 | CT03 | Cold mix patch | 8,460 | 10,765 | 1.2725 |
| WO25-00626 | CT04 | Mastic asphalt | 42,420 | 53,983 | 1.2726 |
| WO25-00435 | CT04 | Drain desilting | 90,000 | 114,541 | 1.2727 |
| WO25-01093 | CT03 | Drain desilting | 90,000 | 114,565 | 1.2729 |
| WO25-02038 | CT02 | Drain desilting | 90,000 | 114,600 | 1.2733 |
| WO25-00272 | CT01 | Cold mix patch | 20,160 | 25,673 | 1.2735 |
| WO25-00013 | CT04 | Desilting and garbage removal | 70,000 | 89,151 | 1.2736 |
| WO25-00242 | CT06 | Drain desilting | 90,000 | 114,626 | 1.2736 |
| WO25-00752 | CT06 | Desilting and garbage removal | 70,000 | 89,167 | 1.2738 |
| WO25-00651 | CT07 | Hot mix patch | 20,540 | 26,168 | 1.2740 |
| WO25-01344 | CT07 | Desilting and garbage removal | 70,000 | 89,206 | 1.2744 |
| WO25-02138 | CT01 | Cold mix patch | 18,900 | 24,086 | 1.2744 |
| WO25-00267 | CT08 | Drain desilting | 90,000 | 114,704 | 1.2745 |
| WO25-01335 | CT07 | Cold mix patch | 6,840 | 8,718 | 1.2746 |
| WO25-00172 | CT05 | Dewatering pump deployed | 60,000 | 76,474 | 1.2746 |
| WO25-02103 | CT03 | Hot mix patch | 6,240 | 7,955 | 1.2748 |
| WO25-00498 | CT08 | Cold mix patch | 18,180 | 23,177 | 1.2749 |
| WO25-00744 | CT03 | Cold mix patch | 14,220 | 18,129 | 1.2749 |
| WO25-02234 | CT07 | Desilting and garbage removal | 70,000 | 89,259 | 1.2751 |
| WO25-00337 | CT08 | Cold mix patch | 16,920 | 21,576 | 1.2752 |
| WO25-01599 | CT08 | Cold mix patch | 20,160 | 25,711 | 1.2753 |
| WO25-01922 | CT07 | Mastic asphalt | 44,100 | 56,254 | 1.2756 |
| WO25-00228 | CT07 | Hot mix patch | 29,900 | 38,142 | 1.2757 |
| WO25-02131 | CT08 | Desilting and garbage removal | 70,000 | 89,305 | 1.2758 |
| WO25-01465 | CT02 | Dewatering pump deployed | 60,000 | 76,555 | 1.2759 |
| WO25-01615 | CT06 | Excavation, pipeline repair, PQC patch | 180,000 | 229,671 | 1.2759 |
| WO25-02319 | CT01 | Dewatering pump deployed | 60,000 | 76,587 | 1.2765 |
| WO25-00227 | CT03 | Mastic asphalt | 28,560 | 36,460 | 1.2766 |
| WO25-01074 | CT03 | Drain desilting | 90,000 | 114,905 | 1.2767 |
| WO25-01798 | CT02 | Dewatering pump deployed | 60,000 | 76,609 | 1.2768 |
| WO25-00596 | CT02 | Pump + debris removal | 110,000 | 140,494 | 1.2772 |
| WO25-00679 | CT06 | Cold mix patch | 18,180 | 23,226 | 1.2776 |
| WO25-00914 | CT07 | Pump + debris removal | 110,000 | 140,560 | 1.2778 |
| WO25-00836 | CT02 | Paver blocks relaid | 19,800 | 25,311 | 1.2783 |
| WO25-00424 | CT04 | Hot mix patch | 2,080 | 2,659 | 1.2784 |
| WO25-01248 | CT03 | Cold mix patch | 9,720 | 12,426 | 1.2784 |
| WO25-00220 | CT02 | Cold mix patch | 3,960 | 5,063 | 1.2785 |
| WO25-02163 | CT01 | Paver blocks relaid | 63,300 | 80,971 | 1.2792 |
| WO25-02395 | CT05 | Manhole cover replaced + grating | 45,000 | 57,574 | 1.2794 |
| WO25-01994 | CT02 | Paver blocks relaid | 116,100 | 148,557 | 1.2796 |
| WO25-02459 | CT02 | Cold mix patch | 21,420 | 27,412 | 1.2797 |
| WO25-02070 | CT06 | Manhole cover replaced + grating | 45,000 | 57,611 | 1.2802 |
| WO25-02365 | CT05 | Cold mix patch | 17,820 | 22,817 | 1.2804 |
| WO25-01448 | CT07 | Hot mix patch | 20,540 | 26,300 | 1.2804 |
| WO25-00209 | CT01 | Pump + debris removal | 110,000 | 140,862 | 1.2806 |
| WO25-00126 | CT04 | Manhole cover replaced + grating | 45,000 | 57,627 | 1.2806 |
| WO25-01769 | CT01 | Cold mix patch | 10,800 | 13,832 | 1.2807 |
| WO25-02254 | CT08 | Excavation, pipeline repair, PQC patch | 180,000 | 230,593 | 1.2811 |
| WO25-00048 | CT05 | Desilting and garbage removal | 70,000 | 89,685 | 1.2812 |
| WO25-02099 | CT08 | Hot mix patch | 7,540 | 9,663 | 1.2816 |
| WO25-00180 | CT04 | Cold mix patch | 6,120 | 7,844 | 1.2817 |
| WO25-01554 | CT01 | Hot mix patch | 16,120 | 20,662 | 1.2818 |
| WO25-00851 | CT07 | Dewatering pump deployed | 60,000 | 76,908 | 1.2818 |
| WO25-01664 | CT04 | Mastic asphalt | 42,420 | 54,374 | 1.2818 |
| WO25-01395 | CT08 | Pump + debris removal | 110,000 | 141,010 | 1.2819 |
| WO25-00468 | CT02 | Hot mix patch | 3,120 | 4,000 | 1.2821 |
| WO25-00691 | CT01 | Paver blocks relaid | 78,300 | 100,387 | 1.2821 |
| WO25-01029 | CT06 | Cold mix patch | 2,700 | 3,462 | 1.2822 |
| WO25-01762 | CT04 | Cold mix patch | 7,379 | 9,464 | 1.2824 |
| WO25-00491 | CT01 | Excavation, pipeline repair, PQC patch | 180,000 | 230,893 | 1.2827 |
| WO25-02489 | CT05 | Cold mix patch | 10,980 | 14,088 | 1.2831 |
| WO25-00073 | CT01 | Cold mix patch | 21,420 | 27,488 | 1.2833 |
| WO25-00380 | CT04 | Cold mix patch | 14,759 | 18,942 | 1.2833 |
| WO25-00411 | CT05 | Manhole cover replaced + grating | 45,000 | 57,761 | 1.2836 |
| WO25-01962 | CT01 | Paver blocks relaid | 34,500 | 44,287 | 1.2837 |
| WO25-01343 | CT08 | Excavation, pipeline repair, PQC patch | 180,000 | 231,095 | 1.2839 |
| WO25-01266 | CT07 | Desilting and garbage removal | 70,000 | 89,882 | 1.2840 |
| WO25-02464 | CT02 | Dewatering pump deployed | 60,000 | 77,055 | 1.2842 |
| WO25-01062 | CT06 | Cold mix patch | 10,080 | 12,946 | 1.2843 |
| WO25-00858 | CT06 | Mastic asphalt | 10,080 | 12,946 | 1.2843 |
| WO25-00187 | CT01 | Drain desilting | 90,000 | 115,616 | 1.2846 |
| WO25-02135 | CT05 | Drain desilting | 90,000 | 115,622 | 1.2847 |
| WO25-02108 | CT03 | Dewatering pump deployed | 60,000 | 77,090 | 1.2848 |
| WO25-00329 | CT02 | Dewatering pump deployed | 60,000 | 77,092 | 1.2849 |
| WO25-01842 | CT08 | Dewatering pump deployed | 60,000 | 77,112 | 1.2852 |
| WO25-02189 | CT06 | Hot mix patch | 17,160 | 22,066 | 1.2859 |
| WO25-00442 | CT04 | Mastic asphalt | 13,020 | 16,748 | 1.2863 |
| WO25-00325 | CT02 | Excavation, pipeline repair, PQC patch | 180,000 | 231,542 | 1.2863 |
| WO25-01438 | CT08 | Cold mix patch | 18,180 | 23,389 | 1.2865 |
| WO25-01715 | CT03 | Hot mix patch | 15,859 | 20,410 | 1.2869 |
| WO25-01409 | CT02 | Pump + debris removal | 110,000 | 141,559 | 1.2869 |
| WO25-00371 | CT02 | Drain desilting | 90,000 | 115,836 | 1.2871 |
| WO25-02219 | CT08 | Excavation, pipeline repair, PQC patch | 180,000 | 231,686 | 1.2871 |
| WO25-01920 | CT01 | Cold mix patch | 12,240 | 15,756 | 1.2873 |
| WO25-01928 | CT05 | Mastic asphalt | 5,880 | 7,570 | 1.2874 |
| WO25-02218 | CT07 | Paver blocks relaid | 82,800 | 106,632 | 1.2878 |
| WO25-00987 | CT08 | Manhole cover replaced + grating | 45,000 | 57,970 | 1.2882 |
| WO25-01230 | CT01 | Mastic asphalt | 5,460 | 7,035 | 1.2885 |
| WO25-00168 | CT04 | Manhole cover replaced + grating | 45,000 | 58,009 | 1.2891 |
| WO25-01469 | CT05 | Dewatering pump deployed | 60,000 | 77,356 | 1.2893 |
| WO25-00994 | CT01 | Cold mix patch | 13,860 | 17,870 | 1.2893 |
| WO25-01447 | CT01 | Mastic asphalt | 41,160 | 53,077 | 1.2895 |
| WO25-00004 | CT04 | Drain desilting | 90,000 | 116,079 | 1.2898 |
| WO25-00935 | CT01 | Manhole cover replaced + grating | 45,000 | 58,044 | 1.2899 |
| WO25-01309 | CT06 | Cold mix patch | 21,420 | 27,629 | 1.2899 |
| WO25-00793 | CT03 | Drain desilting | 90,000 | 116,106 | 1.2901 |
| WO25-00104 | CT05 | Cold mix patch | 19,800 | 25,544 | 1.2901 |
| WO25-02243 | CT08 | Cold mix patch | 18,720 | 24,152 | 1.2902 |
| WO25-00306 | CT06 | Paver blocks relaid | 91,800 | 118,452 | 1.2903 |
| WO25-01666 | CT02 | Desilting and garbage removal | 70,000 | 90,331 | 1.2904 |
| WO25-02303 | CT05 | Manhole cover replaced + grating | 45,000 | 58,078 | 1.2906 |
| WO25-00905 | CT08 | Manhole cover replaced + grating | 45,000 | 58,083 | 1.2907 |
| WO25-01247 | CT02 | Dewatering pump deployed | 60,000 | 77,456 | 1.2909 |
| WO25-00475 | CT01 | Dewatering pump deployed | 60,000 | 77,466 | 1.2911 |
| WO25-00465 | CT06 | Manhole cover replaced + grating | 45,000 | 58,105 | 1.2912 |
| WO25-00164 | CT05 | Cold mix patch | 9,000 | 11,622 | 1.2913 |
| WO25-01375 | CT05 | Desilting and garbage removal | 70,000 | 90,457 | 1.2922 |
| WO25-01828 | CT02 | Desilting and garbage removal | 70,000 | 90,471 | 1.2924 |
| WO25-00488 | CT05 | Pump + debris removal | 110,000 | 142,193 | 1.2927 |
| WO25-01522 | CT05 | Cold mix patch | 3,780 | 4,887 | 1.2929 |
| WO25-00445 | CT01 | Excavation, pipeline repair, PQC patch | 180,000 | 232,749 | 1.2931 |
| WO25-00065 | CT01 | Paver blocks relaid | 115,200 | 148,963 | 1.2931 |
| WO25-01260 | CT07 | Cold mix patch | 17,640 | 22,815 | 1.2934 |
| WO25-00770 | CT01 | Desilting and garbage removal | 70,000 | 90,609 | 1.2944 |
| WO25-02030 | CT08 | Desilting and garbage removal | 70,000 | 90,618 | 1.2945 |
| WO25-00754 | CT02 | Cold mix patch | 14,759 | 19,109 | 1.2946 |
| WO25-00506 | CT02 | Drain desilting | 90,000 | 116,673 | 1.2964 |
| WO25-02406 | CT07 | Mastic asphalt | 15,960 | 20,694 | 1.2966 |
| WO25-01536 | CT01 | Drain desilting | 90,000 | 116,696 | 1.2966 |
| WO25-00944 | CT05 | Dewatering pump deployed | 60,000 | 77,837 | 1.2973 |
| WO25-00899 | CT07 | Mastic asphalt | 29,820 | 38,688 | 1.2974 |
| WO25-00568 | CT02 | Mastic asphalt | 7,560 | 9,810 | 1.2976 |
| WO25-01107 | CT02 | Desilting and garbage removal | 70,000 | 90,838 | 1.2977 |
| WO25-02223 | CT04 | Excavation, pipeline repair, PQC patch | 180,000 | 233,584 | 1.2977 |
| WO25-01648 | CT07 | Pump + debris removal | 110,000 | 142,758 | 1.2978 |
| WO25-00155 | CT07 | Pump + debris removal | 110,000 | 142,793 | 1.2981 |
| WO25-01850 | CT01 | Cold mix patch | 12,060 | 15,658 | 1.2983 |
| WO25-00118 | CT05 | Cold mix patch | 1,260 | 1,636 | 1.2984 |
| WO25-00330 | CT08 | Hot mix patch | 4,420 | 5,739 | 1.2984 |
| WO25-01903 | CT07 | Manhole cover replaced + grating | 45,000 | 58,445 | 1.2988 |
| WO25-01565 | CT02 | Manhole cover replaced + grating | 45,000 | 58,465 | 1.2992 |
| WO25-00342 | CT07 | Cold mix patch | 6,660 | 8,655 | 1.2995 |
| WO25-00359 | CT02 | Drain desilting | 90,000 | 116,961 | 1.2996 |
| WO25-00372 | CT05 | Mastic asphalt | 47,880 | 62,226 | 1.2996 |
| WO25-02291 | CT07 | Cold mix patch | 5,760 | 7,486 | 1.2997 |
| WO25-02490 | CT06 | Mastic asphalt | 23,520 | 30,954 | 1.3161 |
| WO25-01389 | CT07 | Manhole cover replaced + grating | 45,000 | 60,785 | 1.3508 |
| WO25-00405 | CT03 | Cold mix patch | 9,180 | 12,824 | 1.3969 |
| WO25-00018 | CT03 | Manhole cover replaced + grating | 45,000 | 65,624 | 1.4583 |
| WO25-00045 | CT06 | Mastic asphalt | 10,080 | 14,883 | 1.4765 |
| WO25-00763 | CT04 | Hot mix patch | 16,120 | 25,175 | 1.5617 |
| WO25-00645 | CT07 | Drain desilting | 90,000 | 141,029 | 1.5670 |
| WO25-00528 | CT03 | Dewatering pump deployed | 60,000 | 94,496 | 1.5749 |
| WO25-01772 | CT03 | Desilting and garbage removal | 70,000 | 110,281 | 1.5754 |
| WO25-01514 | CT06 | Drain desilting | 90,000 | 142,170 | 1.5797 |
| WO25-02090 | CT07 | Pump + debris removal | 110,000 | 176,993 | 1.6090 |
| WO25-01403 | CT03 | Mastic asphalt | 28,140 | 45,583 | 1.6199 |
| WO25-00831 | CT07 | Cold mix patch | 3,060 | 4,976 | 1.6261 |
| WO25-02100 | CT07 | Drain desilting | 90,000 | 148,317 | 1.6480 |
| WO25-00157 | CT03 | Cold mix patch | 7,020 | 11,570 | 1.6481 |

## 3. DLP classification (exact observed values)

- `dlp_surface_review` work_type: ['Pothole', 'Broken paver blocks', 'Road cave-in']; repair_method: ['Cold mix patch', 'Hot mix patch', 'Mastic asphalt', 'Paver blocks relaid', 'Excavation, pipeline repair, PQC patch'] → **274 jobs, ₹8,729,314**
- `dlp_context_only` work_type: ['Waterlogging', 'Choked drain / nullah overflow', 'Open or broken manhole']; repair_method: ['Dewatering pump deployed', 'Drain desilting', 'Pump + debris removal', 'Manhole cover replaced + grating', 'Desilting and garbage removal'] → **219 jobs, ₹17,496,477** (excluded from suspected DLP-covered expenditure)
- Work-type ↔ method mapping is 1:1 in the data (checked: no job pairs a surface work_type with a context-only method). Total DLP-road jobs 493, ₹26,225,791.
- work_type/method inconsistencies on DLP roads: 0

## 4. External artefacts (outside git)

| path | rows | SHA-256 |
|---|---:|---|
| `hackathon-work/batches/complaints_ambiguous.jsonl` | 43 | `514e3ba4b6c6f455bb3ef31f99f74508ee042f732fa7da4c9b179a49360ade42` |
| `hackathon-work/batches/complaints_sample_200.jsonl` | 200 | `d0f537bbc1124beba5872d3bf956c95829f01db2069f8fb117ee6e81a57dc8f3` |
| `hackathon-work/batches/engineer_remarks_unique.json` | 7 | `0ca744d41f9918cf4bb9b71c801078e868f901b59b22bb872706c9cb040ad315` |
| `hackathon-work/batches/social_posts_all.jsonl` | 650 | `f1cb8b19dae963eb5781b0972fe9b752d9d1abded3faebf08faeb9c30b22c37d` |
| `hackathon-work/complaints_baseline_enriched.csv` | 6501 | `a15447e3e184709b8f6d276b4f2de9a96011cc48e97cb0feed36d33bcbe71153` |
| `hackathon-work/EDA_REPORT.md` | - | `447f33dc9d604d47286fa6e8091b52840348105d77759d802cf916031b95a480` |
| `hackathon-work/road_risk_baseline.csv` | 291 | `4b9441001374b88cbdafe0aef4bc27c53369a2071546f3f9a2ebd94278276654` |
| `hackathon-work/work_orders_audited.csv` | 2499 | `3aefb95e3603e33b727859704a107c0a248097afe7831892e74647d286e8d91d` |

Derived files are reproducible from `pipeline/` and must never be committed (`.gitignore` blocks `pipeline/out/`, derived CSV/JSONL/parquet, `external-inputs/`).
