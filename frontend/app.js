const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://localhost:8000";
const CANONICAL_WARNING = "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const FIELD_LABELS = {
  brand_name: "Brand name",
  class_type: "Class / Type",
  abv: "Alcohol by volume",
  net_contents: "Net contents",
  producer: "Producer",
  country_of_origin: "Country of origin",
  government_warning: "Government warning"
};

const verifyForm = document.getElementById("verifyForm");
const resultsView = document.getElementById("resultsView");
const batchResultsView = document.getElementById("batchResultsView");
const batchRows = document.getElementById("batchRows");
const rowTemplate = document.getElementById("batchRowTemplate");
const submitButton = document.getElementById("submitButton");
const COLD_START_MESSAGE = "Backend waking up - Render free tier may take up to 30 seconds on first request.";
const NETWORK_ERROR_MESSAGE = "Cannot reach the verification service. Check that the backend URL is configured and try again.";

function setCanonicalWarnings() {
  document.querySelectorAll('[name="government_warning"]').forEach((input) => {
    input.value = CANONICAL_WARNING;
  });
}

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateSubmitButton() {
  submitButton.textContent = batchRows.children.length > 1 ? "Verify batch" : "Verify label";
  batchRows.querySelectorAll(".remove").forEach((button) => {
    button.hidden = batchRows.children.length === 1;
  });
}

function resetRowPreview(row) {
  const previewUrl = row.dataset.previewUrl;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    delete row.dataset.previewUrl;
  }
  const selectedFileName = row.querySelector(".selected-file-name");
  if (selectedFileName) {
    selectedFileName.textContent = "";
  }
  const preview = row.querySelector(".label-preview-image");
  if (preview) {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
}

function updateRowPreview(row, file) {
  if (!file) {
    resetRowPreview(row);
    return;
  }
  resetRowPreview(row);
  const previewUrl = URL.createObjectURL(file);
  row.dataset.previewUrl = previewUrl;
  const preview = row.querySelector(".label-preview-image");
  if (preview) {
    preview.src = previewUrl;
    preview.hidden = false;
  }
  const selectedFileName = row.querySelector(".selected-file-name");
  if (selectedFileName) {
    selectedFileName.textContent = `${file.name} - ${formatFileSize(file.size)}`;
  }
}

window.addEventListener("beforeunload", () => {
  batchRows.querySelectorAll(".batch-row").forEach(resetRowPreview);
});

async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) throw new Error("API returned an error");
    await response.json();
    document.documentElement.dataset.service = "ready";
  } catch (error) {
    document.documentElement.dataset.service = "unavailable";
  }
}

function collectApplicationData(scope) {
  const data = {};
  Object.keys(FIELD_LABELS).forEach((name) => {
    const value = scope.querySelector(`[name="${name}"]`).value.trim();
    if (name === "abv") {
      data[name] = `${value}%`;
    } else if (name === "net_contents") {
      data[name] = `${value} mL`;
    } else {
      data[name] = value;
    }
  });
  return data;
}

function rowLabel(row, index) {
  return row.querySelector('[name="item_id"]').value.trim() || row.querySelector("legend").textContent || `Label ${index + 1}`;
}

function validateRow(row, index) {
  const label = rowLabel(row, index);
  const image = row.querySelector('[name="batch_image"]').files[0];
  if (!image) throw new Error(`Choose an image for ${label}.`);

  for (const [name, fieldLabel] of Object.entries(FIELD_LABELS)) {
    const input = row.querySelector(`[name="${name}"]`);
    if (!input.value.trim()) {
      throw new Error(`Enter ${fieldLabel} for ${label}.`);
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function hideMessage(element) {
  element.textContent = "";
  element.hidden = true;
}

function startLoading(element, message) {
  showMessage(element, message);
  return window.setTimeout(() => {
    showMessage(element, COLD_START_MESSAGE);
  }, 3000);
}

function stopLoading(element, timer) {
  window.clearTimeout(timer);
  hideMessage(element);
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.detail || "The request could not be completed.";
  } catch (error) {
    return "The request could not be completed.";
  }
}

function renderExtractionNote(result, target) {
  if (!result.extraction_note) return;
  const note = document.createElement("article");
  note.className = "extraction-note";
  const rawText = result.raw_text
    ? `<p><b>Visible text:</b> ${escapeHtml(result.raw_text)}</p>`
    : "";
  const confidence = typeof result.extraction_confidence === "number"
    ? `<p><b>Extraction confidence:</b> ${Math.round(result.extraction_confidence * 100)}%</p>`
    : "";
  note.innerHTML = `
    <h3>Label could not be read clearly</h3>
    <p>${escapeHtml(result.extraction_note)}</p>
    ${rawText}
    ${confidence}
  `;
  target.appendChild(note);
}

function renderVerification(result, target, verdictTarget = null, summaryTarget = null) {
  if (verdictTarget) {
    const approved = result.overall_verdict === "APPROVED";
    verdictTarget.className = `verdict-banner ${approved ? "approved" : "needs-review"}`;
    verdictTarget.querySelector("h2").textContent = approved ? "APPROVED" : "NEEDS REVIEW";
  }
  if (summaryTarget) {
    summaryTarget.textContent = "Field-by-field results are below.";
  }

  target.innerHTML = "";
  renderExtractionNote(result, target);
  result.results.forEach((item) => {
    const row = document.createElement("article");
    row.className = `result-row ${item.status === "PASS" ? "pass" : "fail"}`;
    const label = FIELD_LABELS[item.field] || item.field;
    const failedMarkup = item.status === "FAIL"
      ? `<div class="result-details"><p><b>Expected:</b> ${escapeHtml(item.expected)}</p><p><b>Found:</b> ${escapeHtml(item.found || "Missing")}</p></div>`
      : "";
    row.innerHTML = `
      <div class="result-row-header">
        <div>
          <h3>${escapeHtml(label)}</h3>
          <p class="detail">${escapeHtml(item.detail)}</p>
        </div>
        <span class="result-status ${item.status === "PASS" ? "pass" : "fail"}">${item.status}</span>
      </div>
      ${failedMarkup}
    `;
    target.appendChild(row);
  });
}

function resetToFreshForm() {
  batchRows.querySelectorAll(".batch-row").forEach((row) => {
    resetRowPreview(row);
    row.remove();
  });
  verifyForm.reset();
  hideMessage(document.getElementById("formError"));
  hideMessage(document.getElementById("verifyProgress"));
  document.getElementById("singleResults").innerHTML = "";
  document.getElementById("batchResults").innerHTML = "";
  document.getElementById("singleSummary").textContent = "Submit a label to see field-by-field results.";
  resultsView.hidden = true;
  batchResultsView.hidden = true;
  verifyForm.hidden = false;
  verifyForm.classList.add("active");
  addBatchRow();
  setCanonicalWarnings();
  submitButton.disabled = false;
  updateSubmitButton();
  verifyForm.scrollIntoView({ behavior: "smooth", block: "start" });
  batchRows.querySelector('[name="batch_image"]').focus();
}

document.getElementById("resetButton").addEventListener("click", resetToFreshForm);
document.getElementById("batchResetButton").addEventListener("click", resetToFreshForm);

function addBatchRow() {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  const index = batchRows.children.length + 1;
  row.querySelector("legend").textContent = `Label ${index}`;
  row.querySelector('[name="item_id"]').value = `Label ${index}`;
  row.querySelector('[name="government_warning"]').value = CANONICAL_WARNING;
  row.querySelector('[name="batch_image"]').addEventListener("change", (event) => {
    updateRowPreview(row, event.target.files[0]);
  });
  row.querySelector(".remove").addEventListener("click", () => {
    resetRowPreview(row);
    row.remove();
    updateSubmitButton();
  });
  batchRows.appendChild(row);
  updateSubmitButton();
}

document.getElementById("addBatchRow").addEventListener("click", addBatchRow);
addBatchRow();

async function submitSingle(row) {
  const data = new FormData();
  const image = row.querySelector('[name="batch_image"]').files[0];
  data.append("image", image);
  data.append("application_data", JSON.stringify(collectApplicationData(row)));
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/verify`, { method: "POST", body: data });
  } catch (error) {
    throw new Error(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) throw new Error(await readError(response));
  renderVerification(
    await response.json(),
    document.getElementById("singleResults"),
    document.getElementById("singleVerdict"),
    document.getElementById("singleSummary")
  );
  resultsView.hidden = false;
  resultsView.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function submitBatch(rows) {
  const data = new FormData();
  const items = rows.map((row, index) => {
    const file = row.querySelector('[name="batch_image"]').files[0];
    data.append("images", file);
    return {
      id: rowLabel(row, index),
      application_data: collectApplicationData(row)
    };
  });
  data.append("items", JSON.stringify(items));
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/verify/batch`, { method: "POST", body: data });
  } catch (error) {
    throw new Error(NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) throw new Error(await readError(response));
  renderBatch(await response.json());
  batchResultsView.hidden = false;
  batchResultsView.scrollIntoView({ behavior: "smooth", block: "start" });
}

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("formError");
  const progress = document.getElementById("verifyProgress");
  const rows = [...batchRows.children];
  hideMessage(error);
  resultsView.hidden = true;
  batchResultsView.hidden = true;

  try {
    if (!rows.length) throw new Error("Add at least one batch row.");
    rows.forEach(validateRow);
  } catch (err) {
    showMessage(error, err.message);
    return;
  }

  const loadingTimer = startLoading(progress, "Reading the label and comparing the application record.");
  submitButton.disabled = true;
  submitButton.textContent = rows.length > 1 ? "Verifying batch..." : "Verifying...";

  try {
    if (rows.length === 1) {
      await submitSingle(rows[0]);
    } else {
      await submitBatch(rows);
    }
    verifyForm.hidden = true;
    verifyForm.classList.remove("active");
  } catch (err) {
    showMessage(error, err.message);
  } finally {
    stopLoading(progress, loadingTimer);
    submitButton.disabled = false;
    updateSubmitButton();
  }
});

function renderBatch(result) {
  document.getElementById("passedCount").textContent = result.summary.passed;
  document.getElementById("reviewCount").textContent = result.summary.needs_review;
  document.getElementById("totalCount").textContent = result.summary.total;

  const target = document.getElementById("batchResults");
  target.innerHTML = "";
  result.items.forEach((item, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = "batch-result-card";
    if (item.error) {
      wrapper.classList.add("fail");
      wrapper.innerHTML = `
        <div class="batch-result-header">
          <h3>${escapeHtml(item.item_id)}</h3>
          <span class="result-status fail">ERROR</span>
        </div>
        <p class="batch-card-summary">${escapeHtml(item.error)}</p>
      `;
    } else {
      const nestedId = `batch-detail-${index}`;
      const approved = item.result.overall_verdict === "APPROVED";
      wrapper.classList.add(approved ? "pass" : "fail");
      wrapper.innerHTML = `
        <div class="batch-result-header">
          <h3>${escapeHtml(item.item_id)}</h3>
          <span class="result-status ${approved ? "pass" : "fail"}">${approved ? "APPROVED" : "NEEDS REVIEW"}</span>
        </div>
        <p class="batch-card-summary">${item.result.results.filter((field) => field.status === "FAIL").length} field(s) need attention.</p>
        <button class="secondary-button compact detail-toggle" type="button" aria-expanded="false" aria-controls="${nestedId}">Show details</button>
        <div id="${nestedId}" class="result-list batch-drilldown" hidden></div>
      `;
      const button = wrapper.querySelector("button");
      const nested = wrapper.querySelector(`#${nestedId}`);
      button.addEventListener("click", () => {
        const hidden = nested.hasAttribute("hidden");
        if (hidden) {
          nested.removeAttribute("hidden");
          button.textContent = "Hide details";
          button.setAttribute("aria-expanded", "true");
          renderVerification(item.result, nested);
        } else {
          nested.setAttribute("hidden", "");
          button.textContent = "Show details";
          button.setAttribute("aria-expanded", "false");
        }
      });
    }
    target.appendChild(wrapper);
  });
}

checkHealth();
