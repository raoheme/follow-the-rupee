// H3 browser proofs. usage: node tests/hackathon/h3_browser.mjs offline | shots <outDir>
import path from "node:path";
import { launch, sleep, setSelectJs, clickTextJs } from "./cdp.mjs";

const BASE = "http://localhost:5173";
const mode = process.argv[2];
const b = await launch({ width: 1440, height: 900 });
const R = {};
const overflow = () => b.ev("document.documentElement.scrollWidth > document.documentElement.clientWidth");
const navTo = async (label) => {
  await b.waitFor(clickTextJs(`/^${label}$/`, "nav"));
  await sleep(1200);
};

try {
  await b.viewport(1440, 900);
  if (mode === "offline") {
    await b.blockUrls(["*tile.openstreetmap.org*", "*openstreetmap.org*"]);
    await b.nav(BASE + "/");
    await b.waitFor("!!document.querySelector('.leaflet-overlay-pane canvas')");
    await sleep(2500);
    // 24 ward polygons + 291 roads are drawn from the API, not from tiles: count by asking the API the page itself uses
    R.counts = await b.ev(`(async()=>{const w=await (await fetch('http://127.0.0.1:8080/v1/monsoon/wards')).json(); const m=await (await fetch('http://127.0.0.1:8080/v1/monsoon/map-triage')).json(); return {wards:w.wards.length, wardsWithGeometry:w.wards.filter(x=>x.geometry&&x.geometry.type==='Polygon').length, roads:m.roads.length, roadsWithGeometry:m.roads.filter(r=>r.geometry&&r.geometry.type==='LineString').length};})()`);
    R.canvasDrawn = await b.ev(`(()=>{const c=document.querySelector('.leaflet-overlay-pane canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n;})()`);
    R.tileImgsLoaded = await b.ev("[...document.querySelectorAll('.leaflet-tile-pane img')].filter(i=>i.complete&&i.naturalWidth>0).length");
    R.legendText = await b.ev("document.querySelector('main').innerText.includes('Locality centroid (coarse, not exact GPS)')");
    R.retryBasemap = await b.ev("/Retry basemap/i.test(document.body.innerText)");
    await b.waitFor(setSelectJs("F/S"));
    await b.waitFor("/Showing \\d+ of \\d+ issues in ward F\\/S/.test(document.querySelector('main').innerText)");
    R.fs = await b.ev("document.querySelector('main').innerText.match(/Showing[^\\n]*/)[0]");
    R.modes = {};
    for (const m of ["Audit Alerts", "Next-Rupee Priority", "Trail Triage"]) {
      await b.waitFor(clickTextJs(`/^${m}$/`));
      await sleep(900);
      R.modes[m] = { pressed: await b.ev(`[...document.querySelectorAll('main button')].some(x=>x.innerText.trim()==='${m}' && (x.getAttribute('aria-pressed')==='true'||/active|selected/.test(x.className)))`), overflow: await overflow() };
    }
    for (const [label, probe] of [
      ["Repair Auditor", "document.querySelectorAll('main table tbody tr').length>0"],
      ["Scorecards & Wards", "document.querySelector('main').innerText.includes('Method-mix expected')"],
      ["Next-Rupee Planner", "/#1 /.test(document.querySelector('main').innerText)"],
      ["Trail Kundali", "document.querySelector('main').innerText.includes('Look up')"],
    ]) {
      await navTo(label);
      await b.waitFor(probe);
      R[label] = { ok: true, overflow: await overflow() };
    }
    const f = b.failures();
    R.failures = { realNonTile: f.real.filter((x) => !/openstreetmap/.test(x.url ?? "")), blocked: f.blocked, aborted: f.aborted };
    R.consoleErrorsNonTile = b.log.console.filter((x) => !/openstreetmap|ERR_BLOCKED_BY_CLIENT/.test(x));
    R.exceptions = b.log.exceptions;
  } else if (mode === "shots") {
    const out = process.argv[3];
    const zoom = (z) => b.ev(`document.documentElement.style.zoom='${z}'`);
    await b.nav(BASE + "/");
    await b.waitFor("!!document.querySelector('.leaflet-overlay-pane canvas')");
    await sleep(3500);
    await b.ev("window.scrollTo(0, 190)");
    await sleep(500);
    await b.shot(path.join(out, "01_map_triage_24wards.png"));

    await b.nav(BASE + "/auditor");
    await b.waitFor("/Showing 100 of 433 rows/.test(document.querySelector('main').innerText)");
    await zoom("0.62");
    await sleep(800);
    await b.shot(path.join(out, "03_repair_auditor.png"));
    await zoom("1");
    await b.ev("(()=>{const i=document.querySelector('main input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'WO25-02486'); i.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(1500);
    await b.waitFor(clickTextJs("/^WO25-02486/"));
    await b.waitFor("document.body.innerText.includes('Evidence · WO25-02486') && document.body.innerText.includes('Contractor metrics')");
    await sleep(800);
    await b.shot(path.join(out, "04_evidence_drawer_wo2486.png"));

    await b.nav(BASE + "/scorecards");
    await b.waitFor("document.querySelector('main').innerText.includes('Method-mix expected')");
    await zoom("0.7");
    await sleep(800);
    await b.shot(path.join(out, "05_fair_scorecards.png"));

    await b.nav(BASE + "/planner");
    await b.waitFor("/#1 /.test(document.querySelector('main').innerText)");
    await b.waitFor(clickTextJs("/^DLP Review First/"));
    await sleep(900);
    await zoom("0.7");
    await b.ev("window.scrollTo(0, 120)");
    await sleep(700);
    await b.shot(path.join(out, "06_next_rupee_planner.png"));
    R.shots = "ok";
    R.consoleErrors = b.log.console;
    R.exceptions = b.log.exceptions;
  }
} catch (e) {
  R.error = String(e.message).slice(0, 400);
} finally {
  b.close();
}
console.log(JSON.stringify(R, null, 1));
