// H2C-2/3: clean judge journey (no unknown-id probes) with console/network/exception capture, desktop then mobile.
// usage: node tests/hackathon/h2c_walk.mjs
import { launch, sleep, setSelectJs, clickTextJs } from "./cdp.mjs";

const BASE = "http://localhost:5173";
const API = "http://127.0.0.1:8080";
const b = await launch({ width: 1440, height: 900 });
const R = { desktop: {}, mobile: {}, planner: {} };
const txt = (sel = "main") => `document.querySelector('${sel}').innerText`;
const overflow = () => b.ev("document.documentElement.scrollWidth > document.documentElement.clientWidth");
const bodyHas = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
const navTo = async (label) => {
  await b.waitFor(clickTextJs(`/^${label}$/`, "nav"));
  await sleep(900);
};
const closeDrawer = async () => {
  await b.ev(clickTextJs("/^Close$/", "body"));
  await sleep(400);
};
const drawerText = () => b.ev(`(()=>{const t=document.body.innerText; const i=t.indexOf('Evidence · '); return i<0?'':t.slice(i, i+12000);})()`);
const setInput = (v) =>
  b.ev(`(()=>{const i=document.querySelector('main input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);

async function journey(tag, mobile) {
  const o = R[tag];
  await b.nav(BASE + "/");
  await b.waitFor(setSelectJs("F/S"));
  await b.waitFor("/Showing 183 of 183 issues in ward F\\/S/.test(document.querySelector('main').innerText)");
  o.mapFS = await b.ev("document.querySelector('main').innerText.match(/Showing[^\\n]*/)[0]");
  o.mapFS_overflow = await overflow();
  await b.ev(setSelectJs("L"));
  await b.waitFor("/in ward L\\./.test(document.querySelector('main').innerText)");
  o.mapL = await b.ev("document.querySelector('main').innerText.match(/Showing[^\\n]*/)[0]");
  o.mapL_overflow = await overflow();
  // map -> drawer via a flagged work order listed for the ward
  const wo = await b.ev("(()=>{const e=[...document.querySelectorAll('main button')].find(x=>/^WO25-\\d+/.test(x.innerText.trim())); if(!e) return null; const id=e.innerText.trim().match(/WO25-\\d+/)[0]; e.click(); return id;})()");
  await sleep(1500);
  o.mapDrawerFor = wo;
  o.mapDrawerOpen = wo ? (await drawerText()).includes(`Evidence · ${wo}`) : false;
  await closeDrawer();

  await navTo("Repair Auditor");
  await b.waitFor("document.querySelectorAll('main table tbody tr').length>0");
  o.auditor_overflow = await overflow();
  await setInput("WO25-02486");
  await sleep(1500);
  await b.waitFor(clickTextJs("/^WO25-02486/"));
  await sleep(1800);
  const dt = await drawerText();
  o.auditorDrawer = { open: dt.includes("Evidence · WO25-02486"), hasRatio: /Ratio/.test(dt), hasDlp: /DLP status/.test(dt), hasRemark: /remark/i.test(dt) };
  o.auditor_overflow_drawer = await overflow();
  await closeDrawer();
  const csv = await b.ev(`(async()=>{const a=[...document.querySelectorAll('a')].find(x=>/Download Audit CSV/.test(x.innerText)); const href=a.href; const r=await fetch(href); const t=(await r.text()).replace(/^\\uFEFF/,''); const lines=t.trim().split(/\\r?\\n/); return {href, ct:r.headers.get('content-type'), cd:r.headers.get('content-disposition'), rows:lines.length-1, header:lines[0].slice(0,80)};})()`);
  o.csv = csv;

  await navTo("Scorecards & Wards");
  await b.waitFor(bodyHas("Fair Contractor"));
  await b.waitFor("document.querySelector('main').innerText.includes('Method-mix expected')");
  const sc = await b.ev(txt());
  o.scorecards = { cards: (sc.match(/Method-mix expected E/g) || []).length, letterGrade: /\b(grade|band)\s*[A-D]\b/i.test(sc), overflow: await overflow() };

  await navTo("Next-Rupee Planner");
  await b.waitFor("/#1 /.test(document.querySelector('main').innerText)");
  o.planner_overflow = await overflow();
  // New Budget first road -> drawer
  await b.waitFor(clickTextJs("/^Inspect Evidence$/"));
  await sleep(1800);
  const nd0 = await drawerText();
  const seg = (t) => { const a = t.indexOf('Road segment'); const e = t.indexOf('Contractor metrics', a); return a < 0 ? '' : t.slice(a, e < 0 ? a + 2500 : e); };
  const nd = seg(nd0);
  R.planner.newBudgetDrawer = {
    text: nd.slice(0, 80).replace(/\n+/g, " | "),
    wardRank: /#\d+ in Ward /.test(nd),
    cityRank: /#\d+ in Mumbai/.test(nd),
    risk: /Risk/.test(nd),
    coverage: /Evidence coverage/.test(nd),
    treatment: /Candidate treatment for engineering review/.test(nd),
    affordable: /Affordable now/.test(nd),
    wardBudget: /Ward budget/.test(nd0),
  };
  await closeDrawer();
  // DLP tab -> RD0220
  await b.waitFor(clickTextJs("/^DLP Review First/"));
  await sleep(700);
  await b.waitFor(`(()=>{const e=document.querySelector('button[aria-label="Open evidence for RD0220"]'); if(!e) return false; e.click(); return true;})()`);
  await sleep(2000);
  const dl0 = await drawerText();
  const dl = (() => { const a = dl0.indexOf('Road segment'); const e = dl0.indexOf('Contractor metrics', a); return a < 0 ? '' : dl0.slice(a, e < 0 ? a + 2500 : e); })();
  R.planner.rd0220Drawer = {
    lane: /DLP Review First/.test(dl),
    defer: dl.includes("Defer new municipal repair allocation pending DLP scope review"),
    caveatFullDrawer: dl0.includes('DLP status is temporal/contextual evidence'),
    caveat: dl.includes("DLP status is temporal/contextual evidence and does not prove contractual applicability or liability"),
    kundaliAction: /Open Kundali/.test(dl0),
    wardBudgetSection: /Ward budget/.test(dl0),
    ranks: (dl.match(/#\d+ in Ward [A-Z/]+ #\d+ in Mumbai/) || [""])[0],
    zeroRupee: /₹0(?![\d,.])/.test(dl),
  };
  await closeDrawer();
  // budget 0: rank invariance
  if (!mobile) {
    await b.waitFor(clickTextJs("/^New Budget Candidates/"));
    await sleep(500);
    const ranks = () => b.ev("[...document.querySelectorAll('main h3')].map(h=>h.innerText).filter(t=>/RD\\d+/.test(t)).slice(0,10).join(' ; ')");
    const before = await ranks();
    await b.ev("document.querySelector('main input[type=checkbox]').click()");
    await sleep(400);
    await b.ev("(()=>{const r=document.querySelector('main input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r, r.min); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await sleep(2500);
    const after = await ranks();
    const t = await b.ev(txt());
    R.planner.rankInvariance = { same: before === after, before: before.slice(0, 90), affordableYes: (t.match(/Affordable now: Yes/g) || []).length, affordableNo: (t.match(/Affordable now: No/g) || []).length };
  }

  await navTo("Trail Kundali");
  for (const id of ["WO25-00611", "BMC25-004589", "RD0220"]) {
    await b.waitFor(`(()=>{const e=[...document.querySelectorAll('main button')].find(x=>x.innerText.trim().startsWith(${JSON.stringify(id)})); if(!e) return false; e.click(); return true;})()`);
    await b.waitFor(`document.querySelector('main').innerText.includes('Record ${id} (')`);
    await sleep(500);
    o[`kundali_${id}`] = { loaded: true, nan: /NaN|undefined|\[object/.test(await b.ev(txt())), overflow: await overflow() };
  }
}

try {
  await b.viewport(1440, 900);
  await journey("desktop", false);
  R.desktopLog = { console: [...b.log.console], exceptions: [...b.log.exceptions], failures: b.failures() };
  b.log.console.length = 0;
  b.log.exceptions.length = 0;
  b.log.failed.length = 0;
  await b.viewport(390, 844, true);
  await journey("mobile", true);
  R.mobileLog = { console: [...b.log.console], exceptions: [...b.log.exceptions], failures: b.failures() };
} catch (e) {
  R.error = String(e.message).slice(0, 400);
  R.partialLog = { console: b.log.console, exceptions: b.log.exceptions };
} finally {
  b.close();
}
console.log(JSON.stringify(R, null, 1));
