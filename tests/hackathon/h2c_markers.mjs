// H2C-1: real clicks on a SOURCE_GPS and a LOCALITY_CENTROID marker in ward F/S; screenshot with both types + legend.
// usage: node tests/hackathon/h2c_markers.mjs <screenshot.png>
import { launch, sleep, setSelectJs, scanCanvasJs } from "./cdp.mjs";

const out = process.argv[2];
const b = await launch({ width: 1440, height: 900 });
const res = { checks: {} };
try {
  await b.viewport(1440, 900);
  await b.nav("http://localhost:5173/");
  await b.waitFor(setSelectJs("F/S"));
  await b.waitFor("/Showing \\d+ of \\d+ issues in ward F\\/S/.test(document.querySelector('main').innerText)");
  await sleep(1500);
  res.checks.countLine = await b.ev("document.querySelector('main').innerText.match(/Showing[^\\n]*/)[0]");
  // bring the map and the legend into view
  await b.ev("(()=>{const m=document.querySelector('[aria-label^=\"Map of\"]'); window.scrollTo(0, m.getBoundingClientRect().top + window.scrollY - 8);})()");
  await sleep(700);
  const group = (cl, dist) => {
    const g = [];
    for (const c of cl) {
      const m = g.find((q) => Math.hypot(q.x - c.x, q.y - c.y) < dist);
      if (m) {
        m.x = (m.x * m.k + c.x) / (m.k + 1);
        m.y = (m.y * m.k + c.y) / (m.k + 1);
        m.k++;
        m.n += c.n;
      } else g.push({ ...c, k: 1 });
    }
    return g;
  };
  const view = await b.ev("({w:innerWidth,h:innerHeight})");
  const inView = (c) => c.x > 20 && c.y > 20 && c.x < view.w * 0.68 && c.y < view.h - 40;
  const gps = group(await b.ev(scanCanvasJs([37, 99, 235], 12, 12)), 6).filter(inView);
  const rings = group(await b.ev(scanCanvasJs([122, 31, 43], 16, 3)), 12).filter(inView).filter((c) => c.k >= 3);
  res.checks.gpsMarkersFound = gps.length;
  res.checks.centroidRingsFound = rings.length;
  if (!gps.length || !rings.length) throw new Error("markers not found on canvas");
  // GPS: solid fill (cluster is a filled disc: pixel count close to pi r^2 for r~5)
  const g0 = gps.sort((a, c) => c.n - a.n)[0];
  res.checks.gpsFilledPixels = g0.n;
  await b.click(g0.x, g0.y);
  await sleep(700);
  const gpsText = await b.ev("(document.querySelector('[data-testid=issue-inspector]')||{innerText:'NO ISSUE INSPECTOR'}).innerText.slice(0,260)");
  res.checks.gpsInspector = gpsText;
  res.checks.gpsInspectorShowsGps = /Source GPS/.test(gpsText) && !/coarse/.test(gpsText);
  // Centroid: hollow ring; centre of the ring must be transparent (not filled)
  const r0 = rings[0];
  const centreFilled = await b.ev(`(()=>{const c=document.querySelector('.leaflet-overlay-pane canvas'); const r=c.getBoundingClientRect(); const px=c.getContext('2d').getImageData(Math.round((${r0.x}-r.left)*c.width/r.width),Math.round((${r0.y}-r.top)*c.height/r.height),1,1).data; return Array.from(px);})()`);
  res.checks.ringCentrePixelRGBA = centreFilled;
  res.checks.ringIsHollow = centreFilled[3] === 0 || !(Math.abs(centreFilled[0] - 122) < 20 && Math.abs(centreFilled[1] - 31) < 20);
  await b.click(r0.x, r0.y);
  await sleep(700);
  const cenText = await b.ev("(document.querySelector('[data-testid=issue-inspector]')||{innerText:'NO ISSUE INSPECTOR'}).innerText.slice(0,260)");
  res.checks.centroidInspector = cenText;
  res.checks.centroidInspectorShowsBadge = cenText.includes("Locality centroid (coarse, not exact GPS)");
  res.checks.legend = await b.ev("(document.querySelector('main').innerText.match(/Source GPS \\(solid\\)[^\\n]*\\n[^\\n]*Locality centroid[^\\n]*/)||['NO LEGEND'])[0]");
  res.checks.unresolvedLine = res.checks.countLine;
  if (out) await b.shot(out);
  res.consoleErrors = b.log.console;
  res.exceptions = b.log.exceptions;
  res.failedRequests = b.failures();
} finally {
  b.close();
}
console.log(JSON.stringify(res, null, 1));
