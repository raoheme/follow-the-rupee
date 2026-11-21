import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMonsoon, useOverview } from "./api";
import { KundaliView } from "./KundaliView";
import { Q } from "./ui";

const ID_RE = /^(BMC25-\d+|WO25-\d+|RD\d+|ISS-[A-Za-z0-9-]+|[A-Za-z0-9-]{4,40})$/;

const CHIPS: ReadonlyArray<readonly [string, string]> = [
  ["WO25-00611", "Rate-card variance review"],
  ["WO25-02486", "Possible duplicate candidate"],
  ["WO25-01723", "DLP surface review"],
  ["BMC25-004589", "Hindi ambulance-entry complaint"],
  ["RD0220", "Ward L road trail"],
];

export function KundaliPage() {
  const [sp, setSp] = useSearchParams();
  const id = sp.get("id") ?? "";
  const [text, setText] = useState(id);
  const [bad, setBad] = useState(false);
  const q = useMonsoon(`/kundali/${encodeURIComponent(id)}`, undefined, !!id);
  const ov = useOverview();
  const go = (v: string) => {
    const t = v.trim();
    setText(t);
    if (!ID_RE.test(t)) {
      setBad(true);
      return;
    }
    setBad(false);
    setSp(new URLSearchParams({ id: t }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(text);
  };
  const spot = ov.data?.spotlight_examples ?? {};
  const why = (cid: string): string | undefined =>
    (Object.values(spot) as Array<{ id?: string; why?: string }>).find((s) => s?.id === cid)?.why;
  return (
    <div className="m-page">
      <h1 id="page-heading" tabIndex={-1} className="m-h1">
        Trail Kundali
      </h1>
      <p className="m-sub">Follow one record from complaint to work order, review math, road, contractor and 30-day outcome. Look up BMC25-… complaints, WO25-… work orders, RD… roads or issue ids.</p>
      <form className="m-search" onSubmit={submit} role="search">
        <label className="m-field m-field--grow">
          <span>Record id</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="BMC25-004589, WO25-00611, RD0220" aria-invalid={bad} />
        </label>
        <button type="submit" className="m-btn m-btn--primary">
          Look up
        </button>
      </form>
      {bad ? (
        <p className="m-note m-note--warn" role="alert">
          That does not look like a complaint, work order, road or issue id.
        </p>
      ) : null}
      <div className="m-chips" role="group" aria-label="Spotlight examples">
        {CHIPS.map(([cid, label]) => (
          <button key={cid} type="button" className="m-chip" aria-pressed={id === cid} title={why(cid)} onClick={() => go(cid)}>
            <b>{cid}</b> <span className="m-sub">{label}</span>
          </button>
        ))}
      </div>
      {id ? (
        <Q q={q} what={`trail for ${id}`}>
          {(d) => <KundaliView data={d} />}
        </Q>
      ) : (
        <p className="m-note">Choose a spotlight example or enter an id.</p>
      )}
    </div>
  );
}
