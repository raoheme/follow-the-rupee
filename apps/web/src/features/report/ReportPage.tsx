import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { newOperationalId } from "../../api/ids";
import { Card } from "../../components/Card";
import { useI18n } from "../../i18n/I18nContext";
import { usePersona } from "../../state/PersonaContext";
import { ErrorNotice } from "../map-list/DataNotice";
import { NO_FILTERS } from "../map-list/filters";
import { ISSUE_CATEGORIES } from "../map-list/model";
import { useMapFeaturesQuery } from "../map-list/queries";
import {
  DEMO_LOCATION,
  DESCRIPTION_MAX,
  EMPTY_REPORT,
  FIELD_ORDER,
  LANDMARK_MAX,
  TITLE_MAX,
  keywordsFrom,
  payloadFingerprint,
  validateReport,
  type FieldErrors,
  type FieldName,
  type ReportValues,
} from "./form";
import { useReportFlow } from "./flow";
import { personaMaySubmit } from "./model";
import { duplicatePath, fill } from "./present";
import { useSubmitIssue } from "./queries";
import { SafetyNotices, StepIndicator } from "./shared";

const FIELD_ID: Record<FieldName, string> = {
  category: "report-category",
  title: "report-title",
  description: "report-description",
  landmark: "report-landmark",
  assetId: "report-asset",
  longitude: "report-longitude",
  latitude: "report-latitude",
};

const FIELD_LABEL_KEY: Record<FieldName, string> = {
  category: "p5.report.field.category",
  title: "p5.report.field.title",
  description: "p5.report.field.description",
  landmark: "p5.report.field.landmark",
  assetId: "p5.report.field.asset",
  longitude: "p5.report.field.longitude",
  latitude: "p5.report.field.latitude",
};

/**
 * PAGE-04: Report Issue. A plain, keyboard-operable form. Validation is local and bounded (contract limits); the server
 * validates again and is the authority. Location is entered as coordinates, so no map or basemap is needed to report.
 * Submitting is a single idempotent command: while it is in flight the button is disabled, and a retry of the same text reuses
 * the same Idempotency-Key, so the server returns the same record instead of creating a second one.
 */
export function ReportPage() {
  const { t } = useI18n();
  const { persona } = usePersona();
  const navigate = useNavigate();
  const flow = useReportFlow();
  const [values, setValues] = useState<ReportValues>(EMPTY_REPORT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const mutation = useSubmitIssue();
  const assets = useMapFeaturesQuery(NO_FILTERS);
  const assetOptions = (assets.data?.data ?? []).filter((f) => f.properties.kind === "ASSET");
  const allowed = personaMaySubmit(persona);

  const revalidate = (next: ReportValues) => {
    if (!showErrors) return;
    const r = validateReport(next);
    setErrors(r.ok ? {} : r.errors);
  };
  const set = (name: FieldName, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    revalidate(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending || !allowed) return;
    const r = validateReport(values);
    if (!r.ok) {
      setErrors(r.errors);
      setShowErrors(true);
      queueMicrotask(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    const fingerprint = payloadFingerprint(r.payload);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: newOperationalId() };
    }
    mutation.mutate(
      { payload: r.payload, key: attempt.current.key },
      {
        onSuccess: (res) => {
          flow.setSubmitted({
            issue: res.data,
            correlationId: res.correlationId,
            keywords: keywordsFrom(r.payload.title, r.payload.publicDescription),
          });
          navigate(duplicatePath(res.data.id));
        },
      },
    );
  };

  const errorList = FIELD_ORDER.filter((f) => errors[f]);
  const errText = (f: FieldName) => (errors[f] ? t(`p5.report.error.${errors[f]}`) : null);

  return (
    <article aria-labelledby="page-heading" className="report">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-04.name")}
      </h1>
      <StepIndicator current="report" />
      <p className="hint">{t("p5.report.intro")}</p>
      <SafetyNotices />
      <p className={allowed ? "hint" : "callout"} role={allowed ? undefined : "status"}>
        {fill(t(allowed ? "p5.report.persona.ok" : "p5.report.persona.blocked"), { persona: t(`persona.option.${persona}`) })}
      </p>

      {showErrors && errorList.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="form-summary" data-testid="validation-summary">
          <h2 className="form-summary__title">{t("p5.report.summary.title")}</h2>
          <ul>
            {errorList.map((f) => (
              <li key={f}>
                <a
                  href={`#${FIELD_ID[f]}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(FIELD_ID[f])?.focus();
                  }}
                >
                  {t(FIELD_LABEL_KEY[f])}
                </a>
                : {errText(f)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate aria-describedby="report-form-note" className="report-form">
        <p id="report-form-note" className="hint">
          {t("p5.syntheticNotice.title")}
        </p>

        <Card id="report-what" title={t("p5.report.about.title")} className="card--compact">
          <Field id={FIELD_ID.category} label={t("p5.report.field.category")} error={errText("category")}>
            <select
              id={FIELD_ID.category}
              name="category"
              value={values.category}
              onChange={(e) => set("category", e.target.value)}
              aria-invalid={errors.category ? true : undefined}
              aria-describedby={errors.category ? `${FIELD_ID.category}-error` : undefined}
              required
            >
              <option value="">{t("p5.report.category.choose")}</option>
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`p1.category.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={FIELD_ID.title}
            label={t("p5.report.field.title")}
            hint={fill(t("p5.report.hint.title"), { max: TITLE_MAX })}
            error={errText("title")}
          >
            <input
              id={FIELD_ID.title}
              name="title"
              type="text"
              autoComplete="off"
              value={values.title}
              maxLength={TITLE_MAX * 2}
              onChange={(e) => set("title", e.target.value)}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={describedBy(FIELD_ID.title, true, !!errors.title)}
              required
            />
          </Field>
          <Field
            id={FIELD_ID.description}
            label={t("p5.report.field.description")}
            hint={fill(t("p5.report.hint.description"), { max: DESCRIPTION_MAX })}
            error={errText("description")}
            counter={fill(t("p5.report.counter"), { used: [...values.description.trim()].length, max: DESCRIPTION_MAX })}
          >
            <textarea
              id={FIELD_ID.description}
              name="description"
              rows={4}
              autoComplete="off"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={describedBy(FIELD_ID.description, true, !!errors.description)}
              required
            />
          </Field>
          <Field
            id={FIELD_ID.landmark}
            label={t("p5.report.field.landmark")}
            hint={fill(t("p5.report.hint.landmark"), { max: LANDMARK_MAX })}
            error={errText("landmark")}
          >
            <input
              id={FIELD_ID.landmark}
              name="landmark"
              type="text"
              autoComplete="off"
              value={values.landmark}
              onChange={(e) => set("landmark", e.target.value)}
              aria-invalid={errors.landmark ? true : undefined}
              aria-describedby={describedBy(FIELD_ID.landmark, true, !!errors.landmark)}
            />
          </Field>
          <Field
            id={FIELD_ID.assetId}
            label={t("p5.report.field.asset")}
            hint={t(assets.isError ? "p5.report.asset.unavailable" : "p5.report.hint.asset")}
            error={errText("assetId")}
          >
            <select
              id={FIELD_ID.assetId}
              name="asset"
              value={values.assetId}
              onChange={(e) => set("assetId", e.target.value)}
              aria-invalid={errors.assetId ? true : undefined}
              aria-describedby={describedBy(FIELD_ID.assetId, true, !!errors.assetId)}
            >
              <option value="">{t(assets.isPending ? "p5.report.asset.loading" : "p5.report.asset.none")}</option>
              {assetOptions.map((a) => (
                <option key={a.id} value={a.properties.recordId}>
                  {a.properties.title}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        <Card id="report-where" title={t("p5.report.location.title")} className="card--compact">
          <p className="hint">{t("p5.report.location.body")}</p>
          <div className="coord-row">
            <Field
              id={FIELD_ID.longitude}
              label={t("p5.report.field.longitude")}
              hint={t("p5.report.hint.coords")}
              error={errText("longitude")}
            >
              <input
                id={FIELD_ID.longitude}
                name="longitude"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.longitude}
                onChange={(e) => set("longitude", e.target.value)}
                aria-invalid={errors.longitude ? true : undefined}
                aria-describedby={describedBy(FIELD_ID.longitude, true, !!errors.longitude)}
                required
              />
            </Field>
            <Field id={FIELD_ID.latitude} label={t("p5.report.field.latitude")} error={errText("latitude")}>
              <input
                id={FIELD_ID.latitude}
                name="latitude"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.latitude}
                onChange={(e) => set("latitude", e.target.value)}
                aria-invalid={errors.latitude ? true : undefined}
                aria-describedby={describedBy(FIELD_ID.latitude, false, !!errors.latitude)}
                required
              />
            </Field>
          </div>
          <p>
            <button
              type="button"
              onClick={() => {
                const next = { ...values, ...DEMO_LOCATION };
                setValues(next);
                revalidate(next);
              }}
            >
              {t("p5.report.location.demo")}
            </button>
          </p>
          <p className="hint">{t("p5.report.location.demoNote")}</p>
        </Card>

        {mutation.isError ? (
          <div className="form-failed">
            <h2 className="form-summary__title">{t("p5.report.failed.title")}</h2>
            <ErrorNotice error={mutation.error} onRetry={() => mutation.reset()} />
            <p className="hint">{t("p5.report.failed.retryHint")}</p>
          </div>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={mutation.isPending || !allowed} aria-disabled={mutation.isPending || !allowed}>
            {t(mutation.isPending ? "p5.report.submitting" : "p5.report.submit")}
          </button>
          <Link className="button-link" to="/page-01">
            {t("p5.back.map")}
          </Link>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {mutation.isPending ? t("p5.loading.sr") : ""}
        </p>
      </form>
    </article>
  );
}

function describedBy(id: string, hasHint: boolean, hasError: boolean): string | undefined {
  const parts = [hasHint ? `${id}-hint` : null, hasError ? `${id}-error` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function Field({
  id,
  label,
  hint,
  error,
  counter,
  hideLabel,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  counter?: string;
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id} className={hideLabel ? undefined : "field__label"}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="hint field__hint">
          {hint}
        </p>
      ) : null}
      {children}
      {counter ? <p className="hint field__counter">{counter}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
