const form = document.getElementById("scrape-form");
const targetUrlInput = document.getElementById("target-url");
const presetSelect = document.getElementById("preset");
const submitButton = document.getElementById("submit-button");

const jobsRunEl = document.getElementById("jobs-run-count");
const recordsExtractedEl = document.getElementById("records-extracted-count");
const completedScrapesEl = document.getElementById("completed-scrapes-count");
const availablePresetsEl = document.getElementById("available-presets-count");

const statusPanelEl = document.getElementById("status-panel");
const statusBadgeEl = document.getElementById("status-badge");
const jobIdEl = document.getElementById("job-id");
const statusMessageEl = document.getElementById("status-message");
const statusDetailEl = document.getElementById("status-detail");
const queueStateEl = document.getElementById("queue-state");
const runStateEl = document.getElementById("run-state");
const selectedPresetLabelEl = document.getElementById("selected-preset-label");
const progressBarEl = document.getElementById("tool-progress-bar");

const resultsPanelEl = document.getElementById("results-panel");
const resultSummaryEl = document.getElementById("result-summary");

const downloadResultsCsvEl = document.getElementById("download-results-csv");
const downloadResultsJsonEl = document.getElementById("download-results-json");
const downloadSummaryTxtEl = document.getElementById("download-summary-txt");
const downloadRunReportEl = document.getElementById("download-run-report");

const failurePanelEl = document.getElementById("failure-panel");
const failureMessageEl = document.getElementById("failure-message");
const failureReasonEl = document.getElementById("failure-reason");
const failureSuggestionEl = document.getElementById("failure-suggestion");

const advancedCtaPanelEl = document.getElementById("advanced-cta-panel");

const API_BASE_URL = "https://api.crkdev.com";

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 240;

let activeJobId = null;
let pollTimer = null;
let pollAttempts = 0;

/* -----------------------------
   Helpers
----------------------------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function safeText(value, fallback = "Not available") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function hideEl(element) {
  element.classList.add("is-hidden");
}

function showEl(element) {
  element.classList.remove("is-hidden");
}

function disableDownloadLink(el) {
  el.href = "#";
  el.classList.add("is-disabled");
  el.setAttribute("aria-disabled", "true");
}

function enableDownloadLink(el, href) {
  if (!href) {
    disableDownloadLink(el);
    return;
  }

  el.href = href;
  el.classList.remove("is-disabled");
  el.setAttribute("aria-disabled", "false");
  el.setAttribute("target", "_blank");
  el.setAttribute("rel", "noopener noreferrer");
}

function clearPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function setProgress(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  progressBarEl.style.width = `${normalized}%`;
}

function setSubmitState(isRunning) {
  submitButton.disabled = isRunning;

  if (isRunning) {
    submitButton.textContent = "Running...";
    submitButton.setAttribute("aria-busy", "true");
  } else {
    submitButton.textContent = "Run Scrape";
    submitButton.removeAttribute("aria-busy");
  }
}

function setStatusState(state, options = {}) {
  const {
    badge = "Ready",
    message = "Submit a supported URL to start a scrape.",
    detail = "Status updates will appear here as the backend processes the job.",
    queueState = "Waiting",
    runState = "Idle",
    progress = 18
  } = options;

  statusPanelEl.classList.remove(
    "is-idle",
    "is-queued",
    "is-running",
    "is-completed",
    "is-failed"
  );

  statusPanelEl.classList.add(`is-${state}`);

  statusBadgeEl.textContent = badge;
  statusMessageEl.textContent = message;
  statusDetailEl.textContent = detail;
  queueStateEl.textContent = queueState;
  runStateEl.textContent = runState;
  setProgress(progress);
}

function resetDownloads() {
  disableDownloadLink(downloadResultsCsvEl);
  disableDownloadLink(downloadResultsJsonEl);
  disableDownloadLink(downloadSummaryTxtEl);
  disableDownloadLink(downloadRunReportEl);
}

function resetResultsPanels() {
  hideEl(resultsPanelEl);
  hideEl(failurePanelEl);
  hideEl(advancedCtaPanelEl);

  resultSummaryEl.innerHTML = `
    <p><strong>Status:</strong> Waiting for completed job</p>
    <p><strong>Summary:</strong> Completed job details will appear here.</p>
  `;

  failureMessageEl.textContent = "No failure message yet.";
  failureReasonEl.textContent = "No failure reason yet.";
  failureSuggestionEl.textContent = "No suggestion yet.";

  resetDownloads();
}

function resetUiForNewJob() {
  clearPolling();
  activeJobId = null;
  pollAttempts = 0;

  resetResultsPanels();

  jobIdEl.textContent = "Not started";
  selectedPresetLabelEl.textContent =
    presetSelect.options[presetSelect.selectedIndex]?.text || "None selected";

  setStatusState("idle", {
    badge: "Ready",
    message: "Submit a supported URL to start a scrape.",
    detail: "Status updates will appear here as the backend processes the job.",
    queueState: "Waiting",
    runState: "Idle",
    progress: 18
  });

  setSubmitState(false);
}

function getDownloadUrl(pathOrUrl) {
  if (!pathOrUrl) return null;

  const value = String(pathOrUrl);

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${API_BASE_URL}${value}`;
  }

  return `${API_BASE_URL}/${value}`;
}

function shouldShowAdvancedCta(data) {
  return Boolean(
    data?.needs_custom_scraping ||
    data?.advanced_scraping_required ||
    data?.custom_extraction_required ||
    data?.show_hire_cta
  );
}

/* -----------------------------
   Stats
----------------------------- */

async function loadStats() {
  try {
    const res = await fetch(`${API_BASE_URL}/scraper/stats`);

    if (!res.ok) {
      throw new Error("Failed to load stats");
    }

    const stats = await res.json();

    jobsRunEl.textContent = formatNumber(stats.jobs_run);
    recordsExtractedEl.textContent = formatNumber(stats.records_extracted);
    completedScrapesEl.textContent = formatNumber(stats.completed_scrapes);
    availablePresetsEl.textContent = formatNumber(stats.available_presets || 4);
  } catch (err) {
    jobsRunEl.textContent = "0";
    recordsExtractedEl.textContent = "0";
    completedScrapesEl.textContent = "0";
    availablePresetsEl.textContent = "4";
  }
}

/* -----------------------------
   Results / Failure Rendering
----------------------------- */

function renderCompletedResults(data) {
  const recordCount = data.records_extracted ?? data.row_count ?? data.records_count ?? 0;
  const pagesVisited = data.pages_visited ?? data.page_count ?? "Not available";
  const duration = data.duration ?? data.duration_seconds ?? "Not available";
  const preset = data.preset ?? presetSelect.value || "Not available";
  const targetUrl = data.target_url ?? targetUrlInput.value || "Not available";

  resultSummaryEl.innerHTML = `
    <p><strong>Status:</strong> Completed</p>
    <p><strong>Job ID:</strong> ${escapeHtml(safeText(data.job_id, activeJobId || "Unknown"))}</p>
    <p><strong>Target URL:</strong> ${escapeHtml(safeText(targetUrl))}</p>
    <p><strong>Preset:</strong> ${escapeHtml(safeText(preset))}</p>
    <p><strong>Records Extracted:</strong> ${escapeHtml(safeText(recordCount))}</p>
    <p><strong>Pages Visited:</strong> ${escapeHtml(safeText(pagesVisited))}</p>
    <p><strong>Duration:</strong> ${escapeHtml(safeText(duration))}</p>
  `;

  const downloads = data.downloads || {};

  enableDownloadLink(
    downloadResultsCsvEl,
    getDownloadUrl(
      downloads.results_csv ||
      downloads.csv ||
      data.results_csv_url ||
      data.csv_url
    )
  );

  enableDownloadLink(
    downloadResultsJsonEl,
    getDownloadUrl(
      downloads.results_json ||
      downloads.json ||
      data.results_json_url ||
      data.json_url
    )
  );

  enableDownloadLink(
    downloadSummaryTxtEl,
    getDownloadUrl(
      downloads.summary_txt ||
      downloads.summary ||
      data.summary_txt_url ||
      data.summary_url
    )
  );

  enableDownloadLink(
    downloadRunReportEl,
    getDownloadUrl(
      downloads.run_report_json ||
      downloads.run_report ||
      data.run_report_url ||
      data.report_url
    )
  );

  showEl(resultsPanelEl);
}

function renderFailure(data) {
  const message =
    data.message ||
    data.error ||
    "The scrape could not be completed.";

  const reason =
    data.reason ||
    data.failure_reason ||
    "The backend did not provide a specific reason.";

  const suggestion =
    data.suggestion ||
    data.failure_suggestion ||
    "Try a different supported URL or preset. If the site requires custom handling, hire CRK Dev.";

  failureMessageEl.textContent = message;
  failureReasonEl.textContent = reason;
  failureSuggestionEl.textContent = suggestion;

  showEl(failurePanelEl);

  if (shouldShowAdvancedCta(data)) {
    showEl(advancedCtaPanelEl);
  } else {
    hideEl(advancedCtaPanelEl);
  }
}

/* -----------------------------
   Polling
----------------------------- */

async function pollJobStatus(jobId) {
  clearPolling();

  if (!jobId) return;

  pollAttempts += 1;

  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    setStatusState("failed", {
      badge: "Timed Out",
      message: "Polling stopped before the job returned a final status.",
      detail: "The job may still be running on the backend, but the frontend stopped waiting.",
      queueState: "Unknown",
      runState: "Timed Out",
      progress: 100
    });

    renderFailure({
      message: "Polling timed out.",
      reason: "The job did not reach a final state within the allowed polling window.",
      suggestion: "Try submitting again later or contact CRK Dev if the issue keeps happening.",
      show_hire_cta: false
    });

    setSubmitState(false);
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/scraper/jobs/${encodeURIComponent(jobId)}`);

    if (!response.ok) {
      let message = `Status request failed (${response.status})`;

      try {
        const error = await response.json();
        if (error.detail) {
          message = error.detail;
        }
      } catch (_) {}

      throw new Error(message);
    }

    const data = await response.json();

    const rawStatus = String(
      data.status ||
      data.state ||
      data.run_status ||
      "unknown"
    ).toLowerCase();

    const queueState =
      data.queue_state ||
      (rawStatus === "queued" ? "Queued" : rawStatus === "running" ? "Dequeued" : "N/A");

    const presetLabel =
      data.preset_label ||
      data.preset ||
      presetSelect.options[presetSelect.selectedIndex]?.text ||
      "Unknown";

    selectedPresetLabelEl.textContent = presetLabel;
    jobIdEl.textContent = data.job_id || jobId;

    if (rawStatus === "queued") {
      setStatusState("queued", {
        badge: "Queued",
        message: data.message || "Your scrape job is queued.",
        detail: data.detail || "The job has been accepted and is waiting to run.",
        queueState: queueState,
        runState: "Queued",
        progress: 30
      });

      setSubmitState(true);
      pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
      return;
    }

    if (rawStatus === "running") {
      setStatusState("running", {
        badge: "Running",
        message: data.message || "Your scrape is in progress.",
        detail: data.detail || "The backend is currently processing the job.",
        queueState: queueState,
        runState: "Running",
        progress: 65
      });

      setSubmitState(true);
      pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
      return;
    }

    if (rawStatus === "completed" || rawStatus === "success") {
      setStatusState("completed", {
        badge: "Completed",
        message: data.message || "Scrape completed successfully.",
        detail: data.detail || "Your output files are ready to download.",
        queueState: queueState,
        runState: "Completed",
        progress: 100
      });

      renderCompletedResults(data);

      if (shouldShowAdvancedCta(data)) {
        showEl(advancedCtaPanelEl);
      }

      setSubmitState(false);
      loadStats();
      return;
    }

    if (rawStatus === "failed" || rawStatus === "error") {
      setStatusState("failed", {
        badge: "Failed",
        message: data.message || "Scrape failed.",
        detail: data.detail || "The backend returned a failure state for this job.",
        queueState: queueState,
        runState: "Failed",
        progress: 100
      });

      renderFailure(data);
      setSubmitState(false);
      return;
    }

    setStatusState("running", {
      badge: "Processing",
      message: data.message || "The job is still being processed.",
      detail: data.detail || "Waiting for a final backend status.",
      queueState: queueState,
      runState: safeText(data.status || data.state || "Processing"),
      progress: 55
    });

    setSubmitState(true);
    pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
  } catch (err) {
    setStatusState("failed", {
      badge: "Error",
      message: "Could not fetch job status.",
      detail: err.message,
      queueState: "Unknown",
      runState: "Error",
      progress: 100
    });

    renderFailure({
      message: "Status polling failed.",
      reason: err.message,
      suggestion: "Try again. If this keeps happening, the backend route or response shape may need to be checked.",
      show_hire_cta: false
    });

    setSubmitState(false);
  }
}

/* -----------------------------
   Submit Job
----------------------------- */

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  clearPolling();
  resetResultsPanels();

  const targetUrl = targetUrlInput.value.trim();
  const preset = presetSelect.value;

  selectedPresetLabelEl.textContent =
    presetSelect.options[presetSelect.selectedIndex]?.text || "None selected";

  if (!targetUrl) {
    setStatusState("failed", {
      badge: "Missing URL",
      message: "Please enter a target URL.",
      detail: "A public URL is required before the scraper can run.",
      queueState: "Not submitted",
      runState: "Validation Error",
      progress: 100
    });

    renderFailure({
      message: "Missing target URL.",
      reason: "The form was submitted without a URL.",
      suggestion: "Enter a valid public URL and try again.",
      show_hire_cta: false
    });

    return;
  }

  if (!preset) {
    setStatusState("failed", {
      badge: "Missing Preset",
      message: "Please select a preset.",
      detail: "A preset is required so the backend knows which workflow to run.",
      queueState: "Not submitted",
      runState: "Validation Error",
      progress: 100
    });

    renderFailure({
      message: "Missing preset.",
      reason: "The form was submitted without a selected preset.",
      suggestion: "Choose the preset that best matches the target site and try again.",
      show_hire_cta: false
    });

    return;
  }

  try {
    setSubmitState(true);

    setStatusState("queued", {
      badge: "Submitting",
      message: "Submitting scrape job...",
      detail: "The request is being sent to the backend.",
      queueState: "Submitting",
      runState: "Submitting",
      progress: 22
    });

    const payload = {
      target_url: targetUrl,
      preset: preset
    };

    const response = await fetch(`${API_BASE_URL}/scraper/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let reason = "The backend rejected the job submission.";
      let suggestion = "Review the URL and preset, then try again.";

      try {
        const error = await response.json();
        if (error.detail) message = error.detail;
        if (error.reason) reason = error.reason;
        if (error.suggestion) suggestion = error.suggestion;
      } catch (_) {}

      throw new Error(JSON.stringify({ message, reason, suggestion }));
    }

    const data = await response.json();

    const jobId = data.job_id || data.id;

    if (!jobId) {
      throw new Error(JSON.stringify({
        message: "The backend accepted the request but did not return a job ID.",
        reason: "Missing job identifier in the response.",
        suggestion: "Check the submit endpoint response shape."
      }));
    }

    activeJobId = jobId;
    pollAttempts = 0;

    jobIdEl.textContent = jobId;

    setStatusState("queued", {
      badge: "Queued",
      message: data.message || "Scrape job submitted successfully.",
      detail: data.detail || "The job is now waiting to run.",
      queueState: data.queue_state || "Queued",
      runState: data.status || "Queued",
      progress: 30
    });

    pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
  } catch (err) {
    let message = "Could not submit scrape job.";
    let reason = err.message;
    let suggestion = "Try again after checking the form values.";

    try {
      const parsed = JSON.parse(err.message);
      message = parsed.message || message;
      reason = parsed.reason || reason;
      suggestion = parsed.suggestion || suggestion;
    } catch (_) {}

    setStatusState("failed", {
      badge: "Error",
      message: message,
      detail: reason,
      queueState: "Not queued",
      runState: "Submission Failed",
      progress: 100
    });

    renderFailure({
      message,
      reason,
      suggestion,
      show_hire_cta: false
    });

    setSubmitState(false);
  }
});

/* -----------------------------
   Preset label sync
----------------------------- */

presetSelect.addEventListener("change", () => {
  selectedPresetLabelEl.textContent =
    presetSelect.options[presetSelect.selectedIndex]?.text || "None selected";
});

/* -----------------------------
   Init
----------------------------- */

resetUiForNewJob();
loadStats();
