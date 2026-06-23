const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://localhost:8000";
const CANONICAL_WARNING = "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const FIELD_LABELS = {
  brand_name: "Brand name",
  class_type: "Class or type",
  abv: "Alcohol content",
  net_contents: "Net contents",
  producer: "Producer",
  country_of_origin: "Country of origin",
  government_warning: "Government warning"
};

document.querySelector('[name="government_warning"]').value = CANONICAL_WARNING;

async function checkHealth() {
  const target = document.getElementById("healthStatus");
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) throw new Error("API returned an error");
    const payload = await response.json();
    target.textContent = `${payload.status.toUpperCase()} - API connected`;
    target.className = "api-status ok";
  } catch (error) {
    target.textContent = "API not connected";
    target.className = "api-status error";
  }
}

function collectApplicationData(scope) {
  const data = {};
  Object.keys(FIELD_LABELS).forEach((name) => {
    data[name] = scope.querySelector(`[name="${name}"]`).value.trim();
  });
  return data;
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

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.detail || "The request could not be completed.";
  } catch (error) {
    return "The request could not be completed.";
  }
}

function renderVerification(result) {
  const verdict = document.getElementById("singleVerdict");
  const latency = document.getElementById("singleLatency");
  const results = document.getElementById("singleResults");
  const approved = result.overall_verdict === "APPROVED";

  verdict.textContent = approved ? "APPROVED" : "NEEDS REVIEW";
  verdict.className = `verdict ${approved ? "pass" : "fail"}`;
  latency.textContent = `Completed in ${result.latency_ms} ms.`;
  results.innerHTML = "";

  result.results.forEach((item) => {
    const row = document.createElement("article");
    row.className = "field-result";
    const label = FIELD_LABELS[item.field] || item.field;
    const failedMarkup = item.status === "FAIL"
      ? `<div class="diff"><span><b>Expected:</b> ${escapeHtml(item.expected)}</span><span><b>Found:</b> ${escapeHtml(item.found || "Missing")}</span></div>`
      : "";
    row.innerHTML = `
      <div class="result-title">
        <strong>${escapeHtml(label)}</strong>
        <span class="badge ${item.status === "PASS" ? "pass" : "fail"}">${item.status}</span>
      </div>
      <p class="detail">${escapeHtml(item.detail)}</p>
      ${failedMarkup}
    `;
    results.appendChild(row);
  });
}

document.getElementById("singleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("singleError");
  const button = form.querySelector("button[type='submit']");
  error.textContent = "";
  button.disabled = true;
  button.textContent = "Checking...";

  try {
    const image = form.image.files[0];
    if (!image) throw new Error("Choose a label image before submitting.");
    const data = new FormData();
    data.append("image", image);
    data.append("application_data", JSON.stringify(collectApplicationData(form)));
    const response = await fetch(`${API_BASE_URL}/verify`, { method: "POST", body: data });
    if (!response.ok) throw new Error(await readError(response));
    renderVerification(await response.json());
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = "Verify label";
  }
});

checkHealth();
