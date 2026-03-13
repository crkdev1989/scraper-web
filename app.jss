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

const API_BASE_URL = "https://api.scraper.crkdev.com";
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 240;

let activeJobId = null;
let pollTimer = null;
let pollAttempts = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeText(value, fallback = "Not available") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function hideEl(element) {
  element.classList.add("is-hidden");
}

function showEl(element) {
  element.classList.remove("is-hidden");
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

function getDownloadUrl(jobId, fileName) {
  return `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileName)}`;
}

function extractErrorPayload(errorData) {
  if (errorData && typeof errorData === "object" && errorData.detail) {
    if (typeof errorData.detail === "object" && errorData.detail !== null) {
      return errorData.detail;
    }

    return {
      status: "failed",
      reason: "request_failed",
      message: String(errorData.detail),
      suggestion: "Please try again."
    };
  }

  if (errorData && typeof errorData === "object") {
    return errorData;
  }

  return {
    status: "failed",
    reason: "request_failed",
    message: "Request failed.",
    suggestion: "Please try again."
  };
}

function shouldShowAdvancedCta(payload) {
  return Boolean(payload && payload.help);
}

function getProgressPercentFromJob(data) {
  const status = String(data?.status || "").toLowerCase();

  if (status === "queued") {
    return 20;
  }

  if (status === "running") {
    const progress = data?.progress || {};
    const pagesScanned = Number(progress.pages_scanned || 0);
    const recordsExtracted = Number(progress.records_extracted || 0);
    const paginationPages = Number(progress.pagination_pages || 0);

    if (pagesScanned === 0 && recordsExtracted === 0 && paginationPages === 0) {
      return 55;
    }

    const pageSignal = Math.min(pagesScanned * 5, 30);
    const recordSignal = recordsExtracted > 0 ? 20 : 0;
    const paginationSignal = Math.min(paginationPages * 4, 15);

    return Math.min(85, 35 + pageSignal + recordSignal + paginationSignal);
  }

  if (status === "completed" || status === "failed") {
    return 100;
  }

  return 18;
}

async function loadPresets() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/presets`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error("Failed to load presets.");
    }

    const presets = Array.isArray(data.presets) ? data.presets : [];
    availablePresetsEl.textContent = formatNumber(presets.length);

    const currentValue = presetSelect.value;
    const optionsHtml = ['<option value="">Select a preset</option>']
      .concat(
        presets.map((preset) => {
          const value = escapeHtml(preset.preset || "");
          const label = escapeHtml(preset.config_name || preset.preset || "Preset");
          return `<option value="${value}">${label}</option>`;
        })
      )
      .join("");

    presetSelect.innerHTML = optionsHtml;

    if (currentValue && presets.some((preset) => preset.preset === currentValue)) {
      presetSelect.value = currentValue;
    }

    selectedPresetLabelEl.textContent =
      presetSelect.options[presetSelect.selectedIndex]?.text || "None selected";
  } catch (err) {
    availablePresetsEl.textContent = "0";
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stats`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error("Failed to load stats.");
    }

    jobsRunEl.textContent = formatNumber(data.jobs_run);
    recordsExtractedEl.textContent = formatNumber(data.records_extracted);
    completedScrapesEl.textContent = formatNumber(data.completed_scrapes);
  } catch (err) {
    jobsRunEl.textContent = "0";
    recordsExtractedEl.textContent = "0";
    completedScrapesEl.textContent = "0";
  }
}

function renderCompletedResults(data) {
  const recordCount = data.records_extracted ?? 0;
  const pagesVisited = data.pages_visited ?? "Not available";
  const paginationUrlsFollowed = data.pagination_urls_followed ?? "Not available";
  const crawlPagesScanned = data.crawl_pages_scanned ?? "Not available";
  const duration = data.run_duration ?? "Not available";
  const preset = data.config_name || data.preset || "Not available";
  const targetUrl = data.target_url || targetUrlInput.value || "Not available";

  resultSummaryEl.innerHTML = `
    <p><strong>Status:</strong> Completed</p>
    <p><strong>Job ID:</strong> ${escapeHtml(safeText(data.job_id, activeJobId || "Unknown"))}</p>
    <p><strong>Target URL:</strong> ${escapeHtml(safeText(targetUrl))}</p>
    <p><strong>Preset:</strong> ${escapeHtml(safeText(preset))}</p>
    <p><strong>Records Extracted:</strong> ${escapeHtml(safeText(recordCount))}</p>
    <p><strong>Pages Visited:</strong> ${escapeHtml(safeText(pagesVisited))}</p>
    <p><strong>Pagination URLs Followed:</strong> ${escapeHtml(safeText(paginationUrlsFollowed))}</p>
    <p><strong>Crawl Pages Scanned:</strong> ${escapeHtml(safeText(crawlPagesScanned))}</p>
    <p><strong>Run Duration:</strong> ${escapeHtml(safeText(duration))}</p>
  `;

  const files = data.files || {};
  const jobId = data.job_id || activeJobId;

  enableDownloadLink(
    downloadResultsCsvEl,
    files["results.csv"]?.available ? getDownloadUrl(jobId, "results.csv") : null
  );

  enableDownloadLink(
    downloadResultsJsonEl,
    files["results.json"]?.available ? getDownloadUrl(jobId, "results.json") : null
  );

  enableDownloadLink(
    downloadSummaryTxtEl,
    files["summary.txt"]?.available ? getDownloadUrl(jobId, "summary.txt") : null
  );

  enableDownloadLink(
    downloadRunReportEl,
    files["run_report.json"]?.available ? getDownloadUrl(jobId, "run_report.json") : null
  );

  showEl(resultsPanelEl);
  hideEl(failurePanelEl);
}

function renderFailureFromPayload(failure) {
  const message =
    failure?.message ||
    "The scrape could not be completed.";

  const reason =
    failure?.reason ||
    "unknown_failure";

  const suggestion =
    failure?.suggestion ||
    "Try another supported URL or preset.";

  failureMessageEl.textContent = message;
  failureReasonEl.textContent = reason;
  failureSuggestionEl.textContent = suggestion;

  showEl(failurePanelEl);
  hideEl(resultsPanelEl);

  if (shouldShowAdvancedCta(failure)) {
    showEl(advancedCtaPanelEl);
  } else {
    hideEl(advancedCtaPanelEl);
  }
}

async function pollJobStatus(jobId) {
  clearPolling();

  if (!jobId) {
    return;
  }

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

    renderFailureFromPayload({
      message: "Polling timed out.",
      reason: "timeout",
      suggestion: "Try again later. If the site is difficult, it may require custom scraping."
    });

    setSubmitState(false);
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}`);
    const data = await response.json();

    if (!response.ok) {
      const errorPayload = extractErrorPayload(data);

      throw new Error(
        JSON.stringify({
          message: errorPayload.message || `Status request failed (${response.status})`,
          reason: errorPayload.reason || "request_failed",
          suggestion: errorPayload.suggestion || "Please try again.",
          help: errorPayload.help || null
        })
      );
    }

    const status = String(data.status || "").toLowerCase();
    const progressPercent = getProgressPercentFromJob(data);

    activeJobId = data.job_id || jobId;
    jobIdEl.textContent = activeJobId;

    selectedPresetLabelEl.textContent =
      data.config_name ||
      data.preset ||
      presetSelect.options[presetSelect.selectedIndex]?.text ||
      "Unknown";

    if (status === "queued") {
      setStatusState("queued", {
        badge: "Queued",
        message: "Your scrape job has been queued.",
        detail: "The backend accepted the job and is waiting to run it.",
        queueState: "Queued",
        runState: "Queued",
        progress: progressPercent
      });

      setSubmitState(true);
      pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
      return;
    }

    if (status === "running") {
      const progress = data.progress || {};
      const phase = data.current_phase || "running";
      const detailParts = [];

      if (progress.pages_scanned) {
        detailParts.push(`Pages scanned: ${progress.pages_scanned}`);
      }
      if (progress.records_extracted) {
        detailParts.push(`Records extracted: ${progress.records_extracted}`);
      }
      if (progress.pagination_pages) {
        detailParts.push(`Pagination pages: ${progress.pagination_pages}`);
      }

      setStatusState("running", {
        badge: "Running",
        message: "Your scrape is in progress.",
        detail: detailParts.length > 0
          ? detailParts.join(" • ")
          : "The backend is currently processing the job.",
        queueState: "Dequeued",
        runState: phase,
        progress: progressPercent
      });

      setSubmitState(true);
      pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
      return;
    }

    if (status === "completed") {
      setStatusState("completed", {
        badge: "Completed",
        message: "Scrape completed successfully.",
        detail: "Your output files are ready to download.",
        queueState: "Finished",
        runState: "Completed",
        progress: 100
      });

      renderCompletedResults(data);
      setSubmitState(false);
      loadStats();
      return;
    }

    if (status === "failed") {
      const failure = data.failure || {
        message: "Scrape failed.",
        reason: "failed",
        suggestion: "Try another supported URL or preset."
      };

      setStatusState("failed", {
        badge: "Failed",
        message: failure.message || "Scrape failed.",
        detail: failure.suggestion || "The backend returned a failure state for this job.",
        queueState: "Finished",
        runState: "Failed",
        progress: 100
      });

      renderFailureFromPayload(failure);
      setSubmitState(false);
      loadStats();
      return;
    }

    setStatusState("running", {
      badge: "Processing",
      message: "The job is still being processed.",
      detail: "Waiting for a final backend status.",
      queueState: "Working",
      runState: safeText(data.current_phase || data.status || "Processing"),
      progress: progressPercent
    });

    setSubmitState(true);
    pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
  } catch (err) {
    let message = "Could not fetch job status.";
    let reason = "request_failed";
    let suggestion = "Try again. If this keeps happening, check the backend.";
    let help = null;

    try {
      const parsed = JSON.parse(err.message);
      message = parsed.message || message;
      reason = parsed.reason || reason;
      suggestion = parsed.suggestion || suggestion;
      help = parsed.help || null;
    } catch (_) {}

    setStatusState("failed", {
      badge: "Error",
      message: message,
      detail: suggestion,
      queueState: "Unknown",
      runState: "Error",
      progress: 100
    });

    renderFailureFromPayload({
      message,
      reason,
      suggestion,
      help
    });

    setSubmitState(false);
  }
}

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

    renderFailureFromPayload({
      message: "Missing target URL.",
      reason: "invalid_target",
      suggestion: "Enter a valid public URL and try again."
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

    renderFailureFromPayload({
      message: "Missing preset.",
      reason: "unsupported_config",
      suggestion: "Choose the preset that best matches the target site and try again."
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
      progress: 15
    });

    const payload = {
      target_url: targetUrl,
      preset: preset
    };

    const response = await fetch(`${API_BASE_URL}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const errorPayload = extractErrorPayload(data);

      throw new Error(
        JSON.stringify({
          message: errorPayload.message || `Request failed (${response.status})`,
          reason: errorPayload.reason || "request_failed",
          suggestion: errorPayload.suggestion || "Review the URL and preset, then try again.",
          help: errorPayload.help || null
        })
      );
    }

    const jobId = data.job_id;

    if (!jobId) {
      throw new Error(
        JSON.stringify({
          message: "The backend accepted the request but did not return a job ID.",
          reason: "missing_job_id",
          suggestion: "Check the submit endpoint response shape."
        })
      );
    }

    activeJobId = jobId;
    pollAttempts = 0;
    jobIdEl.textContent = jobId;

    setStatusState("queued", {
      badge: "Queued",
      message: "Scrape job submitted successfully.",
      detail: "The job is now waiting to run.",
      queueState: "Queued",
      runState: String(data.status || "queued"),
      progress: getProgressPercentFromJob(data)
    });

    pollTimer = setTimeout(() => pollJobStatus(jobId), POLL_INTERVAL_MS);
  } catch (err) {
    let message = "Could not submit scrape job.";
    let reason = "request_failed";
    let suggestion = "Try again after checking the form values.";
    let help = null;

    try {
      const parsed = JSON.parse(err.message);
      message = parsed.message || message;
      reason = parsed.reason || reason;
      suggestion = parsed.suggestion || suggestion;
      help = parsed.help || null;
    } catch (_) {}

    setStatusState("failed", {
      badge: "Error",
      message: message,
      detail: suggestion,
      queueState: "Not queued",
      runState: "Submission Failed",
      progress: 100
    });

    renderFailureFromPayload({
      message,
      reason,
      suggestion,
      help
    });

    setSubmitState(false);
  }
});

presetSelect.addEventListener("change", () => {
  selectedPresetLabelEl.textContent =
    presetSelect.options[presetSelect.selectedIndex]?.text || "None selected";
});

resetUiForNewJob();
loadPresets();
loadStats();
