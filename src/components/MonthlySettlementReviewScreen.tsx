import { useCallback, useEffect, useState } from "react";
import { appPath } from "../ocrPaths";
import { APP_VERSION } from "../appVersion";
import { OcrLanguageSwitch, useOcrLanguage } from "./OcrLanguage";
import "./MonthlySettlementReviewScreen.css";
import "./MonthlySettlementBadges.css";
import "./MonthlySettlementReference.css";

interface MonthlyRow {
  rowNumber: number;
  producer: string | null;
  centerName: string | null;
  liters: number | null;
  ugPercent: number | null;
  gValue: number | null;
  confidence: number;
  uncertainFields: string[];
}
interface MonthlyData {
  documentType: "journal_monthly_settlement";
  layoutType: "detailed" | "overview";
  date: string | null;
  documentMonth?: number | null;
  milkType: string;
  headerCenterName: string | null;
  totalLiters?: number | null;
  rows: MonthlyRow[];
  warnings: string[];
  rawTranscription: string;
}
interface ProducerSuggestion {
  code: string;
  name: string;
  centerCode?: string;
  centerName?: string;
  score?: number;
}
interface ProducerMatch {
  rowNumber: number;
  originalName: string | null;
  status: string;
  selectedName: string | null;
  suggestions: ProducerSuggestion[];
  matchSource?: "header_center_history" | "all_producers";
}
interface MonthlyJob {
  id: string;
  sourceFile: string;
  mimeType: string;
  status: "queued" | "processing" | "completed" | "failed";
  reviewStatus: "pending" | "reviewed";
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  fileUrl: string;
  data?: MonthlyData;
  summary?: {
    date?: string | null;
    documentMonth?: number | null;
    layoutType?: "detailed" | "overview" | null;
    centerName?: string | null;
  };
  openai?: {
    provider?: string;
    model: string;
    durationMs?: number | null;
  } | null;
  producerMatches?: ProducerMatch[];
  headerCenterMatch?: Omit<ProducerMatch, "rowNumber">;
  producerMatchError?: string | null;
  excelExport?: {
    status: string;
    error?: string | null;
    progress?: { current?: number; total?: number };
  };
}

function displayDate(value: string | null) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function displayMonth(job: MonthlyJob, ro: boolean) {
  const monthFromField = job.summary?.documentMonth;
  if (Number.isInteger(monthFromField) && monthFromField! >= 1 && monthFromField! <= 12) {
    const year = String(job.summary?.date || "").match(/^(\d{4})-/u)?.[1];
    const monthName = new Intl.DateTimeFormat(ro ? "ro-RO" : "en-GB", { month: "long" }).format(new Date(2026, monthFromField! - 1, 1));
    return year ? `${monthName} ${year}` : monthName;
  }
  const dateMatch = String(job.summary?.date || "").match(/^(\d{4})-(\d{2})-/u);
  if (dateMatch) {
    const month = Number(dateMatch[2]);
    const monthName = new Intl.DateTimeFormat(ro ? "ro-RO" : "en-GB", { month: "long" }).format(new Date(Number(dateMatch[1]), month - 1, 1));
    return `${monthName} ${dateMatch[1]}`;
  }
  return "";
}

function storeDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value || null;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatOcrDuration(job: MonthlyJob) {
  const elapsed =
    job.openai?.durationMs ??
    (job.startedAt && job.completedAt
      ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
      : null);
  if (elapsed == null || !Number.isFinite(elapsed) || elapsed < 0) return null;
  const seconds = Math.round(elapsed / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
    : `${seconds}s`;
}

export function MonthlySettlementReviewScreen() {
  const { language, setLanguage, isRo } = useOcrLanguage();
  const [view, setView] = useState<"pending" | "reviewed">("pending");
  const [listCollapsed, setListCollapsed] = useState(false);
  const [centerSearch, setCenterSearch] = useState("");
  const [jobs, setJobs] = useState<MonthlyJob[]>([]);
  const [selected, setSelected] = useState<MonthlyJob | null>(null);
  const [draft, setDraft] = useState<MonthlyData | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Record<string, ProducerSuggestion[]>
  >({});
  const [zoom, setZoom] = useState(100);

  const rowLitersTotal =
    draft?.rows.reduce(
      (total, row) =>
        total +
        (typeof row.liters === "number" && Number.isFinite(row.liters)
          ? row.liters
          : 0),
      0,
    ) ?? 0;
  const documentLitersTotal =
    typeof draft?.totalLiters === "number" && Number.isFinite(draft.totalLiters)
      ? draft.totalLiters
      : null;
  const litersDifference =
    documentLitersTotal === null ? null : rowLitersTotal - documentLitersTotal;
  const litersMatch =
    litersDifference !== null && Math.abs(litersDifference) < 0.01;
  const formatLiters = (value: number) =>
    new Intl.NumberFormat(language === "ro" ? "ro-RO" : "en-GB", {
      maximumFractionDigits: 2,
    }).format(value);
  const normalizedCenterSearch = centerSearch.trim().toLocaleLowerCase();
  const filteredJobs = normalizedCenterSearch
    ? jobs.filter((job) =>
        (job.summary?.centerName || job.sourceFile)
          .toLocaleLowerCase()
          .includes(normalizedCenterSearch),
      )
    : jobs;

  const loadJobs = useCallback(async () => {
    const response = await fetch(
      appPath(
        `/api/ocr/jobs?reviewStatus=${view}&documentCategory=journal_monthly_settlement`,
      ),
    );
    const payload = (await response.json()) as {
      jobs?: MonthlyJob[];
      error?: string;
    };
    if (!response.ok)
      throw new Error(payload.error || "Could not load documents.");
    setJobs(payload.jobs || []);
  }, [view]);

  useEffect(() => {
    void loadJobs().catch((error) => setNotice(error.message));
  }, [loadJobs]);
  useEffect(() => {
    const timer = window.setInterval(
      () => void loadJobs().catch(() => undefined),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  async function openJob(job: MonthlyJob) {
    setSelected(job);
    setDraft(null);
    setNotice("");
    setZoom(100);
    if (job.status !== "completed") return;
    const response = await fetch(appPath(`/api/ocr/jobs/${job.id}`));
    const payload = (await response.json()) as {
      job?: MonthlyJob;
      error?: string;
    };
    if (!response.ok || !payload.job?.data)
      return setNotice(payload.error || "Could not load OCR data.");
    const data = structuredClone(payload.job.data);
    if (!data.date) data.date = todayIso();
    setSelected(payload.job);
    setDraft(data);
  }

  async function deleteDocument(job: MonthlyJob) {
    const exported = job.excelExport?.status === "exported";
    const prompt = exported
      ? isRo
        ? `Ștergeți definitiv „${job.sourceFile}”, fișierul încărcat și procesul OCR?\n\nAcest document a fost deja exportat în Excel. Ștergerea de aici nu îl elimină din Excel.`
        : `Permanently delete "${job.sourceFile}", its uploaded file, and OCR process?\n\nThis document was already exported to Excel. Deleting it here will not remove it from Excel.`
      : isRo
        ? `Ștergeți definitiv „${job.sourceFile}”, fișierul încărcat și procesul OCR?`
        : `Permanently delete "${job.sourceFile}", its uploaded file, and OCR process?`;
    if (!window.confirm(prompt)) return;
    setDeletingId(job.id);
    setNotice("");
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${job.id}`), {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        deleted?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.deleted)
        throw new Error(payload.error || "Could not delete the document.");
      if (selected?.id === job.id) {
        setSelected(null);
        setDraft(null);
      }
      setJobs((current) => current.filter((item) => item.id !== job.id));
      setNotice(
        isRo
          ? "Documentul și procesul OCR au fost șterse."
          : "Document and OCR process deleted.",
      );
      await loadJobs();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  function updateRow(index: number, field: keyof MonthlyRow, value: string) {
    if (!draft) return;
    const numeric = ["liters", "ugPercent", "gValue"].includes(field);
    const rows = draft.rows.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [field]: numeric ? (value === "" ? null : Number(value)) : value,
          }
        : row,
    );
    setDraft({ ...draft, rows });
  }

  function deleteRow(rowNumber: number) {
    const prompt = isRo
      ? `Ștergeți rândul ${rowNumber} din acest document?`
      : `Delete row ${rowNumber} from this document?`;
    if (!window.confirm(prompt)) return;
    setDraft((current) =>
      current
        ? {
            ...current,
            rows: current.rows.filter((row) => row.rowNumber !== rowNumber),
            warnings: current.warnings.filter(
              (warning) =>
                !warning.includes(`row ${rowNumber}`) &&
                !warning.includes(`rândul ${rowNumber}`) &&
                !warning.includes(`randul ${rowNumber}`),
            ),
          }
        : current,
    );
    setSelected((current) =>
      current
        ? {
            ...current,
            producerMatches: current.producerMatches?.filter(
              (match) => match.rowNumber !== rowNumber,
            ),
          }
        : current,
    );
    setSuggestions((current) => {
      const next = { ...current };
      delete next[`row-${rowNumber}`];
      return next;
    });
  }

  async function searchProducers(
    key: string,
    value: string,
    kind: "producer" | "center" = "producer",
  ) {
    if (value.trim().length < 2)
      return setSuggestions((current) => ({ ...current, [key]: [] }));
    try {
      const headerCenter =
        kind === "producer" && draft?.layoutType === "detailed"
          ? draft.headerCenterName || ""
          : "";
      const response = await fetch(
        appPath(
          `/api/ocr/producers?q=${encodeURIComponent(value)}&kind=${kind}&headerCenter=${encodeURIComponent(headerCenter)}`,
        ),
      );
      const payload = (await response.json()) as {
        producers?: ProducerSuggestion[];
      };
      setSuggestions((current) => ({
        ...current,
        [key]: payload.producers || [],
      }));
    } catch {
      setSuggestions((current) => ({ ...current, [key]: [] }));
    }
  }

  function referenceNameCell(
    row: MonthlyRow,
    index: number,
    field: "producer" | "centerName",
  ) {
    const key = `row-${row.rowNumber}`;
    const match = selected?.producerMatches?.find(
      (item) => item.rowNumber === row.rowNumber,
    );
    const value = row[field] || "";
    const options = suggestions[key] || match?.suggestions || [];
    return (
      <td className="monthly-reference-cell">
        <input
          list={`${key}-options`}
          value={value}
          onChange={(event) => {
            updateRow(index, field, event.target.value);
            void searchProducers(key, event.target.value);
          }}
        />
        <datalist id={`${key}-options`}>
          {options.map((item) => (
            <option key={`${item.code}-${item.name}`} value={item.name}>
              {Math.round((item.score || 0) * 100)}% · {item.code} ·{" "}
              {item.centerName || ""}
            </option>
          ))}
        </datalist>
        {match?.status === "auto_replaced" && value === match.selectedName && (
          <small className="monthly-system-match">
            {match.matchSource === "header_center_history"
              ? isRo
                ? "Înlocuit folosind istoricul centrului din antet"
                : "Replaced using header-center history"
              : isRo
                ? "Înlocuit din Ref_Producers"
                : "Replaced from Ref_Producers"}
          </small>
        )}
        {value.length >= 2 && suggestions[key] && (
          <small className="monthly-result-count">
            {options.length}{" "}
            {match?.matchSource === "header_center_history"
              ? isRo
                ? "rezultate pentru centrul din antet"
                : "results for header center"
              : isRo
                ? "rezultate"
                : "results"}
          </small>
        )}
      </td>
    );
  }

  async function redoOcr() {
    if (
      !selected ||
      busy ||
      !window.confirm(
        isRo
          ? "Rulați din nou OCR pentru acest document?"
          : "Run OCR again for this document?",
      )
    )
      return;
    setBusy(true);
    setNotice(
      isRo
        ? "Documentul este adăugat din nou în coada OCR…"
        : "Re-queuing document for OCR…",
    );
    try {
      const response = await fetch(
        appPath(`/api/ocr/jobs/${selected.id}/reprocess`),
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not redo OCR.");
      setSelected(null);
      setDraft(null);
      setView("pending");
      await loadJobs();
      setNotice(
        isRo
          ? "OCR a fost repornit în fundal."
          : "OCR was restarted in the background.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function redoFailedOcr(job: MonthlyJob) {
    if (reprocessingId) return;
    setReprocessingId(job.id);
    setNotice(
      isRo
        ? "Documentul este adăugat din nou în coada OCR…"
        : "Re-queuing document for OCR…",
    );
    try {
      const response = await fetch(
        appPath(`/api/ocr/jobs/${job.id}/reprocess`),
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not redo OCR.");
      if (selected?.id === job.id) {
        setSelected(null);
        setDraft(null);
      }
      await loadJobs();
      setNotice(
        isRo
          ? "OCR a fost repornit în fundal."
          : "OCR was restarted in the background.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setReprocessingId(null);
    }
  }

  async function redoExcelMatching() {
    if (!selected || !draft || busy) return;
    setBusy(true);
    setNotice(
      isRo
        ? "Se actualizează Ref_Producers și potrivirile…"
        : "Refreshing Ref_Producers and matches…",
    );
    try {
      const saveResponse = await fetch(
        appPath(`/api/ocr/jobs/${selected.id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: draft }),
        },
      );
      if (!saveResponse.ok)
        throw new Error(
          ((await saveResponse.json()) as { error?: string }).error ||
            "Could not save changes.",
        );
      const response = await fetch(
        appPath(`/api/ocr/jobs/${selected.id}/producers/rematch`),
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        job?: MonthlyJob;
        error?: string;
      };
      if (!response.ok || !payload.job?.data)
        throw new Error(payload.error || "Could not redo Excel matching.");
      setSelected(payload.job);
      setDraft(structuredClone(payload.job.data));
      setNotice(
        isRo
          ? "Potrivirile din Ref_Producers au fost actualizate."
          : "Ref_Producers matching was refreshed.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retryExcelExport() {
    if (!selected || busy) return;
    setBusy(true);
    setNotice(
      isRo
        ? "Retrimitere în Monthly_Settlement…"
        : "Retrying Monthly_Settlement export…",
    );
    try {
      const response = await fetch(
        appPath(`/api/ocr/jobs/${selected.id}/excel/retry`),
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || "Could not retry Excel export.");
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(
          appPath(`/api/ocr/jobs/${selected.id}`),
        );
        const statusPayload = (await statusResponse.json()) as {
          job?: MonthlyJob;
        };
        const job = statusPayload.job;
        if (job?.excelExport?.status === "exporting")
          setNotice(
            isRo
              ? `Se retrimit rândurile în Excel (${job.excelExport.progress?.current || 0}/${job.excelExport.progress?.total || draft?.rows.length || 0})…`
              : `Resending rows to Excel (${job.excelExport.progress?.current || 0}/${job.excelExport.progress?.total || draft?.rows.length || 0})…`,
          );
        if (job?.excelExport?.status === "exported") {
          setSelected(job);
          await loadJobs();
          setNotice(
            isRo
              ? "Exportul în Monthly_Settlement a reușit."
              : "Monthly_Settlement export succeeded.",
          );
          return;
        }
        if (job?.excelExport?.status === "failed")
          throw new Error(
            job.excelExport.error || "Monthly_Settlement export failed.",
          );
      }
      throw new Error(
        isRo
          ? "Exportul durează prea mult; verificați din nou starea."
          : "Export is taking too long; check its status again.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(markReviewed = false) {
    if (!selected || !draft || busy) return;
    setBusy(true);
    setNotice(isRo ? "Se salvează…" : "Saving…");
    try {
      const saveResponse = await fetch(
        appPath(`/api/ocr/jobs/${selected.id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: draft }),
        },
      );
      const savePayload = (await saveResponse.json()) as {
        job?: MonthlyJob;
        error?: string;
      };
      if (!saveResponse.ok)
        throw new Error(savePayload.error || "Could not save changes.");
      if (markReviewed) {
        const reviewResponse = await fetch(
          appPath(`/api/ocr/jobs/${selected.id}/review`),
          { method: "PATCH" },
        );
        const reviewPayload = (await reviewResponse.json()) as {
          job?: MonthlyJob;
          error?: string;
        };
        if (!reviewResponse.ok)
          throw new Error(reviewPayload.error || "Could not mark as reviewed.");
        setNotice(
          isRo
            ? "Trimitere în Monthly_Settlement…"
            : "Sending rows to Monthly_Settlement…",
        );
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          const statusResponse = await fetch(
            appPath(`/api/ocr/jobs/${selected.id}`),
          );
          const statusPayload = (await statusResponse.json()) as {
            job?: MonthlyJob;
          };
          const exportStatus = statusPayload.job?.excelExport?.status;
          const progress = statusPayload.job?.excelExport?.progress;
          if (exportStatus === "exporting")
            setNotice(
              isRo
                ? `Se trimit rândurile în Excel (${progress?.current || 0}/${progress?.total || draft.rows.length})…`
                : `Sending rows to Excel (${progress?.current || 0}/${progress?.total || draft.rows.length})…`,
            );
          if (exportStatus === "exported") {
            setSelected(null);
            setDraft(null);
            await loadJobs();
            setNotice(
              isRo
                ? `${draft.rows.length} rânduri au fost trimise cu succes în Monthly_Settlement.`
                : `${draft.rows.length} rows were successfully sent to Monthly_Settlement.`,
            );
            break;
          }
          if (exportStatus === "failed")
            throw new Error(
              statusPayload.job?.excelExport?.error ||
                "Monthly_Settlement export failed.",
            );
        }
      } else {
        setNotice(
          isRo
            ? "Modificările au fost salvate pe server."
            : "Changes saved on the server.",
        );
      }
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monthly-review">
      <header>
        <div>
          <h1>
            {isRo ? "Verificare decont lunar" : "Monthly Settlement Review"}{" "}
            <small>v{APP_VERSION}</small>
          </h1>
          <p>
            {isRo
              ? "Jurnale detaliate și centralizatoare"
              : "Detailed journals and overview statements"}
          </p>
        </div>
        <nav>
          <button
            onClick={() => {
              window.location.href = appPath("/ocr/upload");
            }}
          >
            {isRo ? "Încărcare" : "Upload"}
          </button>
          <button
            onClick={() => {
              window.location.href = appPath("/ocr/review");
            }}
          >
            {isRo ? "Rute zilnice" : "Daily Routes"}
          </button>
          <button
            onClick={() => {
              window.location.href = appPath("/ocr/compare");
            }}
          >
            {isRo ? "Comparare OCR" : "OCR Compare"}
          </button>
          <button
            onClick={() => {
              window.location.href = appPath("/ocr/settings?from=review");
            }}
          >
            {isRo ? "Setări OCR" : "OCR Settings"}
          </button>
          <OcrLanguageSwitch language={language} onChange={setLanguage} />
        </nav>
      </header>
      {notice && (
        <div className="monthly-notice">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      <main className={listCollapsed ? "monthly-list-collapsed" : ""}>
        <aside>
          <button
            className="monthly-list-toggle"
            type="button"
            onClick={() => setListCollapsed((current) => !current)}
            title={listCollapsed ? (isRo ? "Extindeți lista documentelor" : "Expand document list") : (isRo ? "Restrângeți lista documentelor" : "Collapse document list")}
            aria-label={listCollapsed ? (isRo ? "Extindeți lista documentelor" : "Expand document list") : (isRo ? "Restrângeți lista documentelor" : "Collapse document list")}
            aria-expanded={!listCollapsed}
          >
            <span aria-hidden="true">{listCollapsed ? "›" : "‹"}</span>
            {!listCollapsed && <b>{isRo ? "Restrângeți" : "Collapse"}</b>}
          </button>
          <div className="monthly-list-content">
          <div className="monthly-tabs">
            <button
              className={view === "pending" ? "active" : ""}
              onClick={() => {
                setView("pending");
                setSelected(null);
                setDraft(null);
              }}
            >
              {isRo ? "În așteptare" : "Pending"}
            </button>
            <button
              className={view === "reviewed" ? "active" : ""}
              onClick={() => {
                setView("reviewed");
                setSelected(null);
                setDraft(null);
              }}
            >
              {isRo ? "Verificate" : "Reviewed"}
            </button>
          </div>
          <h2>
            {isRo ? "Documente" : "Documents"} <b>{filteredJobs.length}</b>
          </h2>
          <label className="monthly-search">
            <span>{isRo ? "Căutare centru" : "Search center"}</span>
            <input
              type="search"
              value={centerSearch}
              onChange={(event) => setCenterSearch(event.target.value)}
              placeholder={
                isRo
                  ? "Căutați numele centrului..."
                  : "Search collection center..."
              }
            />
          </label>
          <div className="monthly-list">
            {filteredJobs.map((job) => (
              <div
                className={`monthly-list-card ${selected?.id === job.id ? "active" : ""}`}
                key={job.id}
                role="button"
                tabIndex={0}
                onClick={() => void openJob(job)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    void openJob(job);
                }}
              >
                <button
                  className="monthly-document-delete"
                  type="button"
                  disabled={deletingId === job.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteDocument(job);
                  }}
                  title={
                    isRo
                      ? "Șterge documentul și procesul"
                      : "Delete document and process"
                  }
                  aria-label={
                    isRo
                      ? `Ștergeți ${job.sourceFile}`
                      : `Delete ${job.sourceFile}`
                  }
                >
                  {deletingId === job.id ? "…" : "×"}
                </button>
                <strong>{job.summary?.centerName || job.sourceFile}</strong>
                {displayMonth(job, isRo) && (
                  <span className="monthly-card-month">
                    {isRo ? "Luna" : "Month"}: {displayMonth(job, isRo)}
                  </span>
                )}
                <span className={`monthly-job-status status-${job.status}`}>
                  {job.status === "processing" && <i aria-hidden="true" />}
                  {job.status === "completed"
                    ? job.summary?.layoutType === "detailed"
                      ? isRo
                        ? "Jurnal detaliat"
                        : "Detailed journal"
                      : job.summary?.layoutType === "overview"
                        ? isRo
                          ? "Centralizator"
                          : "Overview"
                        : isRo
                          ? "OCR finalizat"
                          : "OCR complete"
                    : job.status}
                </span>
                {job.openai?.model && (
                  <span className="monthly-model-badge">
                    OCR: {job.openai.provider || "openai"} · {job.openai.model}
                    {formatOcrDuration(job)
                      ? ` · ${formatOcrDuration(job)}`
                      : ""}
                  </span>
                )}
                {job.reviewStatus === "reviewed" && (
                  <span
                    className={`monthly-excel-status status-${job.excelExport?.status || "not_ready"}`}
                  >
                    {job.excelExport?.status === "exported"
                      ? isRo
                        ? "Excel: Exportat"
                        : "Excel: Exported"
                      : job.excelExport?.status === "failed"
                        ? isRo
                          ? "Excel: Eroare"
                          : "Excel: Failed"
                        : ["queued", "exporting"].includes(
                              job.excelExport?.status || "",
                            )
                          ? isRo
                            ? "Excel: Se trimite"
                            : "Excel: Sending"
                          : isRo
                            ? "Excel: Netrimis"
                            : "Excel: Not sent"}
                  </span>
                )}
                <small>{new Date(job.createdAt).toLocaleString()}</small>
                {job.status === "failed" && (
                  <>
                    <em>{job.error}</em>
                    <button
                      className="monthly-card-redo"
                      type="button"
                      disabled={Boolean(reprocessingId)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void redoFailedOcr(job);
                      }}
                    >
                      {reprocessingId === job.id
                        ? isRo
                          ? "Se adaugă în coadă…"
                          : "Queuing…"
                        : isRo
                          ? "Refaceți OCR"
                          : "Redo OCR"}
                    </button>
                  </>
                )}
              </div>
            ))}
            {filteredJobs.length === 0 && (
              <div className="monthly-list-empty">
                {isRo
                  ? "Nu s-au găsit documente pentru acest centru."
                  : "No documents found for this center."}
              </div>
            )}
          </div>
          </div>
        </aside>
        <section className="monthly-workspace">
          {!selected ? (
            <div className="monthly-empty">
              {isRo
                ? "Selectați un document pentru verificare."
                : "Select a document to review."}
            </div>
          ) : (
            <>
              <article className="monthly-source">
                <div className="monthly-source-title">
                  <div>
                    <h2>{isRo ? "Document sursă" : "Source document"}</h2>
                    <span>{selected.sourceFile}</span>
                  </div>
                  <div
                    className="monthly-zoom-controls"
                    aria-label="Document zoom controls"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setZoom((current) => Math.max(50, current - 25))
                      }
                      aria-label={isRo ? "Micșorare" : "Zoom out"}
                    >
                      −
                    </button>
                    <span>{zoom}%</span>
                    <button
                      type="button"
                      onClick={() =>
                        setZoom((current) => Math.min(250, current + 25))
                      }
                      aria-label={isRo ? "Mărire" : "Zoom in"}
                    >
                      +
                    </button>
                    <button type="button" onClick={() => setZoom(100)}>
                      {isRo ? "Potrivire" : "Fit"}
                    </button>
                  </div>
                </div>
                {selected.mimeType === "application/pdf" ? (
                  <iframe
                    key={`${selected.id}-${zoom}`}
                    src={`${selected.fileUrl}#zoom=${zoom}`}
                  />
                ) : (
                  <div className="monthly-source-document">
                    <img
                      style={{
                        width: `${zoom}%`,
                        maxWidth: zoom <= 100 ? "100%" : "none",
                      }}
                      src={selected.fileUrl}
                      alt={selected.sourceFile}
                    />
                  </div>
                )}
              </article>
              <article className="monthly-data">
                <div className="monthly-data-title">
                  <div>
                    <h2>{isRo ? "Date recunoscute" : "Recognised data"}</h2>
                    <span>
                      {draft?.layoutType === "detailed"
                        ? isRo
                          ? "Jurnal detaliat"
                          : "Detailed journal"
                        : isRo
                          ? "Centralizator"
                          : "Overview"}
                    </span>
                    {formatOcrDuration(selected) && (
                      <b className="monthly-selected-ocr-time">
                        {isRo ? "Durată OCR" : "OCR time"}: {formatOcrDuration(selected)}
                      </b>
                    )}
                  </div>
                  {draft && (
                    <div>
                      {selected.excelExport?.status === "failed" && (
                        <button
                          className="retry"
                          onClick={() => void retryExcelExport()}
                          disabled={busy}
                        >
                          {isRo
                            ? "Retrimiteți în Excel"
                            : "Send to Excel again"}
                        </button>
                      )}
                      <button onClick={() => void save(false)} disabled={busy}>
                        {isRo ? "Salvați" : "Save changes"}
                      </button>
                      <button
                        className="primary"
                        onClick={() => void save(true)}
                        disabled={busy}
                      >
                        {isRo
                          ? "Salvați, verificați și trimiteți în Excel"
                          : "Save, mark reviewed and send to Excel"}
                      </button>
                    </div>
                  )}
                </div>
                {!draft ? (
                  <div className="monthly-empty">
                    {selected.status === "failed"
                      ? selected.error
                      : isRo
                        ? "OCR este în curs…"
                        : "OCR is processing…"}
                  </div>
                ) : (
                  <div className="monthly-form">
                    <div className="monthly-fields">
                      <label>
                        {isRo ? "Data" : "Date"}
                        <input
                          value={displayDate(draft.date)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              date: storeDate(e.target.value),
                              documentMonth: null,
                            })
                          }
                          placeholder="dd/MM/yyyy"
                        />
                        {draft.documentMonth && (
                          <small className="monthly-derived-date">
                            {isRo
                              ? "Ultima zi a lunii identificate, anul curent"
                              : "Last day of identified month, current year"}
                          </small>
                        )}
                      </label>
                      <label>
                        {isRo ? "Tip lapte" : "Milk type"}
                        <input
                          value={draft.milkType}
                          onChange={(e) =>
                            setDraft({ ...draft, milkType: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        {isRo ? "Centru antet" : "Header center"}
                        <input
                          list="monthly-header-centers"
                          value={draft.headerCenterName || ""}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              headerCenterName: e.target.value,
                            });
                            void searchProducers(
                              "header",
                              e.target.value,
                              "center",
                            );
                          }}
                        />
                        <datalist id="monthly-header-centers">
                          {(
                            suggestions.header ||
                            selected.headerCenterMatch?.suggestions ||
                            []
                          ).map((item) => (
                            <option
                              key={`${item.code}-${item.name}`}
                              value={item.name}
                            >
                              {Math.round((item.score || 0) * 100)}% ·{" "}
                              {item.code}
                            </option>
                          ))}
                        </datalist>
                        {selected.headerCenterMatch?.status ===
                          "auto_replaced" &&
                          draft.headerCenterName ===
                            selected.headerCenterMatch.selectedName && (
                            <small className="monthly-system-match">
                              {isRo
                                ? "Înlocuit din Ref_Producers"
                                : "Replaced from Ref_Producers"}
                            </small>
                          )}
                      </label>
                    </div>
                    <div
                      className={`monthly-liters-summary ${documentLitersTotal === null ? "unknown" : litersMatch ? "matches" : "mismatch"}`}
                      aria-live="polite"
                    >
                      <div>
                        <span>{isRo ? "Total rânduri" : "Rows total"}</span>
                        <strong>{formatLiters(rowLitersTotal)} L</strong>
                      </div>
                      <label>
                        <span>
                          {isRo ? "Total OCR document" : "Document OCR total"}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={draft.totalLiters ?? ""}
                          placeholder={isRo ? "Nedetectat" : "Not detected"}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              totalLiters:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <b>
                        {documentLitersTotal === null
                          ? isRo
                            ? "! Fără total OCR pentru comparație"
                            : "! No OCR total to compare"
                          : litersMatch
                            ? isRo
                              ? "✓ Totalurile corespund"
                              : "✓ Totals match"
                            : `! ${isRo ? "Diferență" : "Difference"}: ${litersDifference! > 0 ? "+" : ""}${formatLiters(litersDifference!)} L`}
                      </b>
                    </div>
                    {draft.warnings.length > 0 && (
                      <div className="monthly-warnings">
                        <strong>
                          {isRo ? "De verificat" : "Items to verify"}
                        </strong>
                        <ul>
                          {draft.warnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selected.producerMatchError && (
                      <div className="monthly-match-error">
                        {selected.producerMatchError}
                      </div>
                    )}
                    <div className="monthly-table">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            {draft.layoutType === "detailed" ? (
                              <>
                                <th>{isRo ? "Producător" : "Producer"}</th>
                                <th>{isRo ? "Ultimul total" : "Last total"}</th>
                                <th>U.G. %</th>
                              </>
                            ) : (
                              <>
                                <th>
                                  {isRo
                                    ? "Centru / producător"
                                    : "Center / producer"}
                                </th>
                                <th>{isRo ? "Litri" : "Liters"}</th>
                                <th>G</th>
                              </>
                            )}
                            <th className="monthly-row-actions">
                              {isRo ? "Acțiuni" : "Actions"}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {draft.rows.map((row, index) => (
                            <tr key={`${row.rowNumber}-${index}`}>
                              <td>
                                {row.rowNumber}
                                <small>
                                  {Math.round(row.confidence * 100)}%
                                </small>
                              </td>
                              {draft.layoutType === "detailed" ? (
                                <>
                                  {referenceNameCell(row, index, "producer")}
                                  <td>
                                    <input
                                      type="number"
                                      value={row.liters ?? ""}
                                      onChange={(e) =>
                                        updateRow(
                                          index,
                                          "liters",
                                          e.target.value,
                                        )
                                      }
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      step="any"
                                      value={row.ugPercent ?? ""}
                                      onChange={(e) =>
                                        updateRow(
                                          index,
                                          "ugPercent",
                                          e.target.value,
                                        )
                                      }
                                    />
                                    {row.gValue !== null &&
                                      row.liters !== null &&
                                      row.liters > 0 &&
                                      row.ugPercent !== null &&
                                      Math.abs(
                                        row.ugPercent - row.gValue / row.liters,
                                      ) < 0.001 && (
                                        <small className="monthly-calculated-value">
                                          {isRo ? "Calculat" : "Calculated"}:{" "}
                                          {row.gValue} ÷ {row.liters}
                                        </small>
                                      )}
                                  </td>
                                </>
                              ) : (
                                <>
                                  {referenceNameCell(row, index, "centerName")}
                                  <td>
                                    <input
                                      type="number"
                                      value={row.liters ?? ""}
                                      onChange={(e) =>
                                        updateRow(
                                          index,
                                          "liters",
                                          e.target.value,
                                        )
                                      }
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      step="any"
                                      value={row.gValue ?? ""}
                                      onChange={(e) =>
                                        updateRow(
                                          index,
                                          "gValue",
                                          e.target.value,
                                        )
                                      }
                                    />
                                   </td>
                                 </>
                               )}
                              <td>
                                <button
                                  className="monthly-row-delete"
                                  type="button"
                                  onClick={() => deleteRow(row.rowNumber)}
                                  title={
                                    isRo
                                      ? `Ștergeți rândul ${row.rowNumber}`
                                      : `Delete row ${row.rowNumber}`
                                  }
                                  aria-label={
                                    isRo
                                      ? `Ștergeți rândul ${row.rowNumber}`
                                      : `Delete row ${row.rowNumber}`
                                  }
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="monthly-bottom-actions">
                      <button
                        type="button"
                        onClick={() => void redoOcr()}
                        disabled={busy}
                      >
                        {isRo ? "Refaceți OCR" : "Redo OCR"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void redoExcelMatching()}
                        disabled={busy}
                      >
                        {isRo
                          ? "Refaceți potrivirea Excel"
                          : "Redo Excel matching"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
