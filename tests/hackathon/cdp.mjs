// Minimal Chrome DevTools Protocol driver (no dependencies; Node >= 22 global WebSocket + fetch).
// Used by the hackathon browser walks to get exact-size screenshots, real clicks and error/network capture.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1440, height = 900, mobile = false, port = 9333 } = {}) {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("no Chrome/Edge found");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcl-cdp-"));
  const proc = spawn(
    exe,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"],
    { stdio: "ignore" },
  );
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const log = { console: [], exceptions: [], failed: [], http: [], blocked: [] };
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { r, j } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? j(new Error(JSON.stringify(d.error))) : r(d.result);
      return;
    }
    switch (d.method) {
      case "Runtime.exceptionThrown":
        log.exceptions.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text);
        break;
      case "Runtime.consoleAPICalled":
        if (d.params.type === "error") log.console.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
        break;
      case "Log.entryAdded":
        if (d.params.entry.level === "error") log.console.push(`${d.params.entry.text} ${d.params.entry.url ?? ""}`);
        break;
      case "Network.loadingFailed":
        log.failed.push({ id: d.params.requestId, err: d.params.errorText, blocked: d.params.blockedReason });
        break;
      case "Network.requestWillBeSent":
        log.http.push({ id: d.params.requestId, url: d.params.request.url, method: d.params.request.method });
        break;
      case "Network.responseReceived":
        if (d.params.response.status >= 400) log.failed.push({ id: d.params.requestId, status: d.params.response.status, url: d.params.response.url });
        break;
    }
    listeners.forEach((l) => l(d));
  };
  const send = (method, params = {}) =>
    new Promise((r, j) => {
      const i = ++id;
      pending.set(i, { r, j });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await Promise.all(["Page", "Runtime", "Network", "Log"].map((d) => send(`${d}.enable`)));
  const api = {
    log,
    /** Failed/4xx-5xx requests with their URLs; Leaflet-cancelled tile images (ERR_ABORTED) are reported separately. */
    failures() {
      const url = new Map(log.http.map((h) => [h.id, h.url]));
      const all = log.failed.map((f) => ({ ...f, url: f.url ?? url.get(f.id) ?? "" }));
      return {
        aborted: all.filter((f) => f.err === "net::ERR_ABORTED").length,
        blocked: all.filter((f) => f.blocked || f.err === "net::ERR_BLOCKED_BY_CLIENT").length,
        real: all.filter((f) => f.err !== "net::ERR_ABORTED" && !f.blocked && f.err !== "net::ERR_BLOCKED_BY_CLIENT"),
      };
    },
    send,
    async viewport(w, h, isMobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: isMobile });
    },
    async nav(url) {
      await send("Page.navigate", { url });
      await sleep(800);
    },
    async ev(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expr, timeout = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try {
          if (await api.ev(expr)) return true;
        } catch {}
        await sleep(250);
      }
      throw new Error(`waitFor timeout: ${expr}`);
    },
    async click(x, y) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      }
    },
    async shot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async blockUrls(urls) {
      await send("Network.setBlockedURLs", { urls });
    },
    close() {
      try {
        ws.close();
        proc.kill();
      } catch {}
      setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1500);
    },
  };
  return api;
}

/** Set a React-controlled <select> inside <main> by option value. */
export const setSelectJs = (value) => `(() => { const s=[...document.querySelectorAll('main select')].find(x=>[...x.options].some(o=>o.value==='${value}')); if(!s) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${value}'); s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

/** Click an element by visible text (button/a), returns whether found. */
export const clickTextJs = (re, scope = "main") => `(() => { const e=[...document.querySelectorAll('${scope} button, ${scope} a')].find(b=>${re}.test(b.innerText.trim())); if(!e) return false; e.click(); return true; })()`;

/** Scan the Leaflet overlay canvas for pixels near an RGB colour; returns cluster centres in CSS px (page coordinates). */
export const scanCanvasJs = (rgb, tol = 14, minPx = 4) => `(() => {
  const c=document.querySelector('.leaflet-overlay-pane canvas'); if(!c) return [];
  const ctx=c.getContext('2d'); const w=c.width,h=c.height; const d=ctx.getImageData(0,0,w,h).data;
  const r0=c.getBoundingClientRect(); const sx=r0.width/w, sy=r0.height/h; const seen=new Uint8Array(w*h); const out=[];
  const near=(i)=>Math.abs(d[i]-${rgb[0]})<=${tol}&&Math.abs(d[i+1]-${rgb[1]})<=${tol}&&Math.abs(d[i+2]-${rgb[2]})<=${tol}&&d[i+3]>150;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x; if(seen[p]||!near(p*4))continue; let st=[p],n=0,sxx=0,syy=0,minx=x,maxx=x,miny=y,maxy=y; seen[p]=1;
    while(st.length){const q=st.pop(); const qx=q%w,qy=(q/w)|0; n++; sxx+=qx; syy+=qy; if(qx<minx)minx=qx; if(qx>maxx)maxx=qx; if(qy<miny)miny=qy; if(qy>maxy)maxy=qy;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=qx+dx,ny=qy+dy; if(nx<0||ny<0||nx>=w||ny>=h)continue; const np=ny*w+nx; if(!seen[np]&&near(np*4)){seen[np]=1; st.push(np);}}}
    if(n>=${minPx}) out.push({n, bw:maxx-minx+1, bh:maxy-miny+1, x:r0.left+((minx+maxx)/2)*sx, y:r0.top+((miny+maxy)/2)*sy});}
  return out; })()`;
