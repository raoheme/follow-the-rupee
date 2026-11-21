import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card, Disclosure, Fact, Facts, Tag } from "../../components/Card";
import { useI18n, type Translate } from "../../i18n/I18nContext";
import { formatInr } from "../../lib/currency";
import { isSynId, readIdParam } from "../../lib/synId";
import { formatUtc } from "../map-list/Inspector";
import type { BudgetTrace, DlpView, WorkOrderDetail } from "./model";
import { kundaliPath, TRACE_EXAMPLES, tracePath } from "./links";
import { CHAIN_ORDER, DLP_STYLE, showsPotentialDlpWording, stepState, TRACE_STYLE, type ChainStep } from "./present";
import { useBudgetTraceQuery, useWorkOrderQuery } from "./queries";
import { LoadingNotice, MalformedNotice, QueryFailure } from "./states";
import { DataNotice } from "../map-list/DataNotice";

/**
 * PAGE-03: Work Order and Budget Trace. `?budgetId=` drives `GET /v1/budget-traces/{id}` and `?workOrderId=` drives
 * `GET /v1/works/{id}`; both are validated locally first and never echoed. With only a work order, the budget id is read
 * from the work order's own contract (one dependent request, not a search). Nothing here enumerates or discovers records.
 */
export function TracePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const budgetParam = readIdParam(params, "budgetId");
  const workParam = readIdParam(params, "workOrderId");
  const workId = workParam.kind === "valid" ? workParam.id : null;

  const workQ = useWorkOrderQuery(workId);
  const derivedBudget = workQ.data ? workQ.data.data.contract.budgetId : null;
  const budgetId = budgetParam.kind === "valid" ? budgetParam.id : budgetParam.kind === "absent" ? derivedBudget : null;
  const traceQ = useBudgetTraceQuery(budgetId);

  const nothingChosen = budgetParam.kind === "absent" && workParam.kind === "absent";
  const mismatch =
    budgetParam.kind === "valid" && workQ.data && workQ.data.data.contract.budgetId !== budgetParam.id ? true : false;

  return (
    <article aria-labelledby="page-heading" className="dossier">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-03.name")}
      </h1>
      <TraceSelector selectedBudget={budgetId} />
      {budgetParam.kind === "malformed" ? <MalformedNotice which="budget" /> : null}
      {workParam.kind === "malformed" ? <MalformedNotice which="work" /> : null}
      {nothingChosen ? (
        <p className="hint" data-testid="trace-prompt">
          {t("p4.trace.choose")}
        </p>
      ) : null}
      {mismatch ? (
        <DataNotice state="partial" title={t("p4.trace.mismatch.title")} live="status">
          <p>{t("p4.trace.mismatch.body")}</p>
        </DataNotice>
      ) : null}

      {budgetId !== null ? (
        traceQ.isPending ? (
          <LoadingNotice />
        ) : traceQ.isError ? (
          <QueryFailure error={traceQ.error} onRetry={() => void traceQ.refetch()} />
        ) : (
          <TraceContent trace={traceQ.data.data} workId={workId} />
        )
      ) : null}

      {workId !== null ? (
        workQ.isPending ? (
          <LoadingNotice />
        ) : workQ.isError ? (
          <QueryFailure error={workQ.error} onRetry={() => void workQ.refetch()} />
        ) : (
          <WorkContent w={workQ.data.data} />
        )
      ) : null}
    </article>
  );
}

function TraceSelector({ selectedBudget }: { selectedBudget: string | null }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!isSynId(v)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    navigate(tracePath({ budgetId: v }));
  };

  const body = (
    <>
      <ul className="selector-list selector-list--row">
        {TRACE_EXAMPLES.map((ex) => (
          <li key={ex.key}>
            <Link
              className="selector-link"
              to={tracePath({ budgetId: ex.budgetId, workOrderId: ex.workOrderId })}
              aria-current={selectedBudget === ex.budgetId ? "true" : undefined}
            >
              <span className="selector-link__title">{t(`p4.trace.example.${ex.key}`)}</span>
              <span className="selector-link__meta">
                <code>{ex.budgetId}</code>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="hint">{t("p4.trace.selector.scope")}</p>
      <form className="id-form" onSubmit={submit} noValidate>
        <div className="control">
          <label htmlFor="trace-budget-id">{t("p4.trace.manual.label")}</label>
          <input
            id="trace-budget-id"
            name="budgetId"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            value={value}
            aria-invalid={invalid}
            aria-describedby={invalid ? "trace-budget-error" : "trace-budget-help"}
            onChange={(e) => {
              setValue(e.target.value);
              if (invalid) setInvalid(false);
            }}
          />
          <p id="trace-budget-help" className="hint">
            {t("p4.trace.manual.help")}
          </p>
          {invalid ? (
            <p id="trace-budget-error" role="alert" className="field-error">
              {t("p4.malformed.body.budget")}
            </p>
          ) : null}
        </div>
        <button type="submit">{t("p4.trace.manual.submit")}</button>
      </form>
    </>
  );

  return (
    <Card id="trace-select-heading" title={t("p4.trace.selector.title")} className="card--compact">
      {selectedBudget !== null ? <Disclosure summary={t("p4.trace.selector.change")}>{body}</Disclosure> : body}
    </Card>
  );
}

function stepLabel(t: Translate, step: ChainStep) {
  return t(`p4.chain.step.${step}`);
}

function TraceContent({ trace, workId }: { trace: BudgetTrace; workId: string | null }) {
  const { t } = useI18n();
  const ts = TRACE_STYLE[trace.traceabilityStatus] ?? { icon: "•", tone: "neutral" as const };
  const present: Record<ChainStep, boolean> = {
    BUDGET: true,
    TENDER: trace.tender !== null,
    CONTRACT: trace.contract !== null,
    WORK_ORDER: trace.workOrder !== null,
    ASSET_GEOMETRY: trace.asset !== null,
  };
  return (
    <Card id="trace-heading" title={trace.budget.displayTitle} className="trace">
      <p className="trace__status">
        <Tag tone={ts.tone} icon={ts.icon} label={t(`p4.trace.status.${trace.traceabilityStatus}`)} />
      </p>
      <Facts>
        <Fact label={t("p4.trace.budget")}>
          {formatInr(trace.budget.amountPaise)} <code>{trace.budget.id}</code>
        </Fact>
        <Fact label={t("p4.trace.book")}>
          {trace.budget.budgetBookName} · {trace.budget.financialYear}
        </Fact>
        <Fact label={t("p4.trace.lastProven")}>{t(`p4.chain.link.${trace.lastProvenLink}`)}</Fact>
        <Fact label={t("p4.trace.missingNext")}>
          {trace.missingNextLink ? t(`p4.chain.missing.${trace.missingNextLink}`) : t("p4.trace.noneMissing")}
        </Fact>
      </Facts>
      {/* the API's own explanation, verbatim: it already states that a gap is not an allegation */}
      <p className="callout">{trace.explanation}</p>

      <ol className="chain" aria-label={t("p4.chain.label")}>
        {CHAIN_ORDER.map((step) => {
          const state = stepState(step, present[step], trace.missingNextLink);
          return (
            <li key={step} className="chain__step" data-state={state}>
              <p className="chain__head">
                <strong>{stepLabel(t, step)}</strong>{" "}
                <span className="chain__state">
                  <span aria-hidden="true">{state === "proven" ? "✔" : state === "missing" ? "⚠" : "—"}</span> {t(`p4.chain.state.${state}`)}
                </span>
              </p>
              {state === "proven" ? <ChainDetail step={step} trace={trace} /> : null}
            </li>
          );
        })}
      </ol>

      <p className="actions">
        {trace.workOrder && workId === null ? (
          <Link className="button-link" to={tracePath({ budgetId: trace.budget.id, workOrderId: trace.workOrder.id })}>
            {t("p4.trace.loadWork")}
          </Link>
        ) : null}
        <Link className="button-link" to="/page-01">
          {t("p4.actions.map")}
        </Link>
      </p>
    </Card>
  );
}

function ChainDetail({ step, trace }: { step: ChainStep; trace: BudgetTrace }) {
  const { t } = useI18n();
  switch (step) {
    case "BUDGET":
      return (
        <p>
          {trace.budget.budgetHead} · {formatInr(trace.budget.amountPaise)}
        </p>
      );
    case "TENDER":
      return trace.tender ? (
        <>
          <p>
            {trace.tender.title} · <code>{trace.tender.tenderReference}</code>
          </p>
          <p>
            {t(`p4.tender.status.${trace.tender.status}`)} · {formatInr(trace.tender.estimatedValuePaise)}
          </p>
          <p className="hint">{trace.tender.locationDescription}</p>
        </>
      ) : null;
    case "CONTRACT":
      return trace.contract ? (
        <>
          <p>
            {trace.contract.displayTitle} · {formatInr(trace.contract.valuePaise)}
          </p>
          {trace.contractor ? (
            <p>
              {trace.contractor.displayName} <span className="hint">({trace.contractor.syntheticNote})</span>
            </p>
          ) : null}
        </>
      ) : null;
    case "WORK_ORDER":
      return trace.workOrder ? (
        <p>
          {trace.workOrder.displayTitle} · {formatInr(trace.workOrder.valuePaise)} · <code>{trace.workOrder.id}</code>
        </p>
      ) : null;
    case "ASSET_GEOMETRY":
      return trace.asset ? (
        <p>
          {trace.asset.displayName} · {trace.asset.streetName}
        </p>
      ) : null;
  }
}

function WorkContent({ w }: { w: WorkOrderDetail }) {
  const { t } = useI18n();
  const d: DlpView | null = w.dlpStatus;
  const ds = d ? (DLP_STYLE[d.status] ?? { icon: "•", tone: "neutral" as const }) : null;
  return (
    <Card id="work-detail-heading" title={t("p4.work.detail")}>
      <p className="card__lead">
        <strong>{w.workOrder.displayTitle}</strong> <code>{w.workOrder.id}</code>
      </p>
      <p>{w.workOrder.publicDescription}</p>
      <Facts>
        <Fact label={t("p4.work.value")}>{formatInr(w.workOrder.valuePaise)}</Fact>
        <Fact label={t("p4.work.status")}>{t(`p4.work.status.${w.workOrder.status}`)}</Fact>
        <Fact label={t("p4.work.started")}>{w.workOrder.startedOn}</Fact>
        <Fact label={t("p4.work.certified")}>{w.workOrder.completionCertifiedOn ?? t("p4.work.notCertified")}</Fact>
        <Fact label={t("p4.work.contract")}>
          {w.contract.displayTitle} · {formatInr(w.contract.valuePaise)}
        </Fact>
        <Fact label={t("p4.work.contractor")}>
          {w.contractor.displayName} <span className="hint">({w.contractor.syntheticNote})</span>
        </Fact>
        <Fact label={t("p4.work.asset")}>
          {w.asset.displayName} · {w.asset.streetName}
        </Fact>
        {d && ds ? (
          <Fact label={t("p4.dlp.label")}>
            <Tag tone={ds.tone} icon={ds.icon} label={t(`p4.dlp.status.${d.status}`)} />
          </Fact>
        ) : null}
        {d ? <Fact label={t("p4.dlp.until")}>{formatUtc(d.dlpEndsAt)}</Fact> : null}
        {d ? <Fact label={t("p4.dlp.evaluated")}>{formatUtc(d.evaluatedAt)}</Fact> : null}
      </Facts>
      {d ? (
        <Disclosure summary={t("p4.dlp.details")}>
          {showsPotentialDlpWording(d.status) ? <p className="callout">{t("p4.dlp.claimSafe")}</p> : null}
          <p>{d.explanation}</p>
          <p>{d.warrantyPathNote}</p>
          {d.syntheticFreshRepairEstimatePaise !== null ? (
            <p>
              {t("p4.dlp.estimate")}: {formatInr(d.syntheticFreshRepairEstimatePaise)}
              {d.potentialSpendLabel ? ` (${t("p4.dlp.potentialLabel")})` : ""}
            </p>
          ) : null}
        </Disclosure>
      ) : null}
      <h3 className="card__subtitle">{t("p4.work.linked")}</h3>
      {w.linkedIssueIds.length === 0 ? (
        <p>{t("p4.work.linkedNone")}</p>
      ) : (
        <ul className="plain-list">
          {w.linkedIssueIds.map((id) => (
            <li key={id}>
              <Link to={kundaliPath(id)}>
                <code>{id}</code> — {t("p4.actions.kundali")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
