import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const FIELD_NAMES = [
  "brand_name",
  "class_type",
  "abv",
  "net_contents",
  "producer",
  "country_of_origin",
  "government_warning",
];
const PRODUCTION_API_BASE_URL = "https://ttb-label-verification-api-zgnb.onrender.com";
const CANONICAL_WARNING = "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

function verificationResult() {
  return {
    results: FIELD_NAMES.map((field) => ({
      field,
      match_type: field === "government_warning" ? "exact_case_sensitive" : "fuzzy",
      expected: "expected",
      found: "found",
      status: "PASS",
      detail: "ok",
    })),
    overall_verdict: "APPROVED",
    latency_ms: 1200,
  };
}

function extractionFailureResult() {
  return {
    ...verificationResult(),
    results: FIELD_NAMES.map((field) => ({
      field,
      match_type: field === "government_warning" ? "exact_case_sensitive" : "fuzzy",
      expected: "expected",
      found: null,
      status: "FAIL",
      detail: "missing",
    })),
    overall_verdict: "NEEDS_REVIEW",
    extraction_note: "The label could not be read clearly. Try a closer, sharper photo.",
    raw_text: "glared bottle",
    extraction_confidence: 0.2,
  };
}

function batchResult() {
  return {
    items: [
      { item_id: "Label 1", result: verificationResult(), error: null },
      { item_id: "Label 2", result: verificationResult(), error: null },
    ],
    summary: { passed: 2, needs_review: 0, total: 2 },
  };
}

function batchExtractionFailureResult() {
  return {
    items: [
      { item_id: "Label 1", result: extractionFailureResult(), error: null },
      { item_id: "Label 2", result: verificationResult(), error: null },
    ],
    summary: { passed: 1, needs_review: 1, total: 2 },
  };
}

function setupApp(fetchImpl) {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost:5173",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.APP_CONFIG = { API_BASE_URL: "https://api.example.test" };
  window.URL.createObjectURL = () => "blob:label";
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.scrolledIntoView = "true";
  };
  window.fetch = fetchImpl;
  window.eval(app);
  return { dom, window };
}

function waitForRender() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function fillRow(window, row, index = 1) {
  const file = new window.File([`fake-image-${index}`], `label-${index}.jpg`, { type: "image/jpeg" });
  Object.defineProperty(row.querySelector('[name="batch_image"]'), "files", {
    configurable: true,
    value: [file],
  });
  const values = {
    brand_name: "Old Harbor",
    class_type: "Straight Bourbon Whiskey",
    abv: "45",
    net_contents: "750",
    producer: "Okorie Spirits Co.",
    country_of_origin: "United States",
    government_warning: "GOVERNMENT WARNING: sample",
  };
  for (const [name, value] of Object.entries(values)) {
    row.querySelector(`[name="${name}"]`).value = value;
  }
  return { file, values };
}

test("one label card posts image and seven application fields to /verify", async () => {
  const fetchCalls = [];
  const { window } = setupApp(async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new window.Response(JSON.stringify(verificationResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await Promise.resolve();

  const form = window.document.getElementById("verifyForm");
  const row = window.document.querySelector(".batch-row");
  const { file } = fillRow(window, row);

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const verifyCall = fetchCalls.find((call) => String(call.url).endsWith("/verify"));
  assert.ok(verifyCall, "expected a POST /verify call");
  assert.equal(verifyCall.options.method, "POST");
  assert.ok(verifyCall.options.body instanceof window.FormData);
  assert.equal(verifyCall.options.body.get("image"), file);
  const applicationData = JSON.parse(verifyCall.options.body.get("application_data"));
  assert.deepEqual(Object.keys(applicationData).sort(), FIELD_NAMES.toSorted());
  assert.equal(applicationData.abv, "45%");
  assert.equal(applicationData.net_contents, "750 mL");
});

test("empty required single-label field blocks submit with a clear message", async () => {
  const fetchCalls = [];
  const { window } = setupApp(async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new window.Response(JSON.stringify(verificationResult()), { status: 200 });
  });
  await Promise.resolve();

  const row = window.document.querySelector(".batch-row");
  fillRow(window, row);
  row.querySelector('[name="brand_name"]').value = "";

  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await waitForRender();

  assert.equal(window.document.getElementById("formError").textContent, "Enter Brand name for Label 1.");
  assert.equal(fetchCalls.some((call) => String(call.url).endsWith("/verify")), false);
});

test("empty numeric fields do not submit placeholder units", async () => {
  const fetchCalls = [];
  const { window } = setupApp(async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new window.Response(JSON.stringify(verificationResult()), { status: 200 });
  });
  await Promise.resolve();

  const row = window.document.querySelector(".batch-row");
  fillRow(window, row);
  row.querySelector('[name="abv"]').value = "";

  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await waitForRender();

  assert.equal(window.document.getElementById("formError").textContent, "Enter Alcohol by volume for Label 1.");
  assert.equal(fetchCalls.some((call) => String(call.url).endsWith("/verify")), false);
});

test("single-label extraction note renders above field results", async () => {
  const { window } = setupApp(async (url) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response(JSON.stringify(extractionFailureResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await Promise.resolve();

  fillRow(window, window.document.querySelector(".batch-row"));
  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const note = window.document.querySelector("#singleResults .extraction-note");
  assert.ok(note, "expected an extraction note");
  assert.match(note.textContent, /The label could not be read clearly/);
  assert.match(note.textContent, /Visible text:\s*glared bottle/);
  assert.match(note.textContent, /Extraction confidence:\s*20%/);
});

test("single-label results hide latency and review another returns to a fresh form", async () => {
  const { window } = setupApp(async (url) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response(JSON.stringify(verificationResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await Promise.resolve();

  const form = window.document.getElementById("verifyForm");
  const row = window.document.querySelector(".batch-row");
  fillRow(window, row);

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(form.hidden, true);
  assert.equal(window.document.getElementById("resultsView").hidden, false);
  assert.equal(window.document.getElementById("singleSummary").textContent, "Field-by-field results are below.");
  assert.doesNotMatch(window.document.getElementById("singleVerdict").textContent, /Completed in \d+ ms/);

  window.document.getElementById("resetButton").click();
  const freshRows = [...window.document.querySelectorAll(".batch-row")];
  assert.equal(form.hidden, false);
  assert.equal(window.document.getElementById("resultsView").hidden, true);
  assert.equal(window.document.getElementById("batchResultsView").hidden, true);
  assert.equal(freshRows.length, 1);
  assert.equal(freshRows[0].querySelector('[name="brand_name"]').value, "");
  assert.equal(freshRows[0].querySelector('[name="government_warning"]').value, CANONICAL_WARNING);
  assert.equal(freshRows[0].dataset.previewUrl, undefined);
  assert.equal(form.dataset.scrolledIntoView, "true");
  assert.equal(window.document.activeElement, freshRows[0].querySelector('[name="batch_image"]'));
});

test("two label cards post images and items to /verify/batch", async () => {
  const fetchCalls = [];
  const { window } = setupApp(async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new window.Response(JSON.stringify(batchResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await Promise.resolve();

  window.document.getElementById("addBatchRow").click();
  const rows = [...window.document.querySelectorAll(".batch-row")];
  fillRow(window, rows[0], 1);
  fillRow(window, rows[1], 2);

  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const batchCall = fetchCalls.find((call) => String(call.url).endsWith("/verify/batch"));
  assert.ok(batchCall, "expected a POST /verify/batch call");
  const formData = batchCall.options.body;
  assert.equal(formData.getAll("images").length, 2);
  const items = JSON.parse(formData.get("items"));
  assert.equal(items.length, 2);
  assert.equal(items[0].application_data.abv, "45%");
  assert.equal(items[0].application_data.net_contents, "750 mL");
});

test("batch validation identifies the incomplete row and field", async () => {
  const fetchCalls = [];
  const { window } = setupApp(async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new window.Response(JSON.stringify(batchResult()), { status: 200 });
  });
  await Promise.resolve();

  window.document.getElementById("addBatchRow").click();
  const rows = [...window.document.querySelectorAll(".batch-row")];
  fillRow(window, rows[0], 1);
  fillRow(window, rows[1], 2);
  rows[1].querySelector('[name="country_of_origin"]').value = "";

  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    window.document.getElementById("formError").textContent,
    "Enter Country of origin for Label 2."
  );
  assert.equal(fetchCalls.some((call) => String(call.url).endsWith("/verify/batch")), false);
});

test("batch drill-down surfaces item extraction note", async () => {
  const { window } = setupApp(async (url) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response(JSON.stringify(batchExtractionFailureResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await Promise.resolve();

  window.document.getElementById("addBatchRow").click();
  const rows = [...window.document.querySelectorAll(".batch-row")];
  fillRow(window, rows[0], 1);
  fillRow(window, rows[1], 2);
  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await waitForRender();

  window.document.querySelector(".detail-toggle").click();
  const note = window.document.querySelector("#batchResults .extraction-note");
  assert.ok(note, "expected an extraction note in batch details");
  assert.match(note.textContent, /The label could not be read clearly/);
});

test("batch review another returns to one clean label card", async () => {
  const { window } = setupApp(async (url) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response(JSON.stringify(batchResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await Promise.resolve();

  window.document.getElementById("addBatchRow").click();
  const rows = [...window.document.querySelectorAll(".batch-row")];
  fillRow(window, rows[0], 1);
  fillRow(window, rows[1], 2);
  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await waitForRender();

  assert.equal(window.document.getElementById("batchResultsView").hidden, false);
  window.document.getElementById("batchResetButton").click();

  const freshRows = [...window.document.querySelectorAll(".batch-row")];
  assert.equal(window.document.getElementById("verifyForm").hidden, false);
  assert.equal(window.document.getElementById("batchResultsView").hidden, true);
  assert.equal(freshRows.length, 1);
  assert.equal(freshRows[0].querySelector("legend").textContent, "Label 1");
  assert.equal(freshRows[0].querySelector('[name="brand_name"]').value, "");
  assert.equal(window.document.activeElement, freshRows[0].querySelector('[name="batch_image"]'));
});

test("batch card exterior uses blue while nested failures stay orange", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(
    styles,
    /\.batch-result-card\.fail\s*\{[^}]*border-color:\s*var\(--color-navy-dark\);[^}]*border-left-color:\s*var\(--color-navy-dark\);[^}]*\}/s
  );
  assert.match(
    styles,
    /\.batch-drilldown \.result-row\.fail\s*\{[^}]*border-color:\s*#f7b267;[^}]*border-left-color:\s*var\(--color-orange\);[^}]*\}/s
  );
});

test("batch summary metrics use themed state accents", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(
    styles,
    /\.verdict-banner\.batch-summary \.summary div\s*\{[^}]*background:\s*#ffffff;[^}]*border-left:\s*6px solid var\(--color-navy-dark\);[^}]*\}/s
  );
  assert.match(
    styles,
    /\.verdict-banner\.batch-summary \.summary div:nth-child\(1\)\s*\{[^}]*border-left-color:\s*var\(--color-green\);[^}]*\}/s
  );
  assert.match(
    styles,
    /\.verdict-banner\.batch-summary \.summary div:nth-child\(2\)\s*\{[^}]*border-left-color:\s*var\(--color-orange\);[^}]*\}/s
  );
  assert.match(
    styles,
    /\.verdict-banner\.batch-summary \.summary div:nth-child\(3\)\s*\{[^}]*border-left-color:\s*var\(--color-navy-dark\);[^}]*\}/s
  );
});

test("cold-start loading copy appears after three seconds", async () => {
  const { window } = setupApp(async (url) => {
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Promise(() => {});
  });
  await Promise.resolve();
  fillRow(window, window.document.querySelector(".batch-row"));

  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 3100));

  assert.match(
    window.document.getElementById("verifyProgress").textContent,
    /Backend waking up - Render free tier may take up to 30 seconds/
  );
});

test("verification network failures show a helpful service message", async () => {
  const { window } = setupApp(async (url) => {
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    throw new TypeError("Failed to fetch");
  });
  await Promise.resolve();
  fillRow(window, window.document.querySelector(".batch-row"));

  window.document.getElementById("verifyForm").dispatchEvent(new window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    window.document.getElementById("formError").textContent,
    "Cannot reach the verification service. Check that the backend URL is configured and try again."
  );
});

test("build config uses API_BASE_URL when provided", () => {
  const configUrl = new URL("./config.js", import.meta.url);
  const originalConfig = readFileSync(configUrl, "utf8");
  try {
    execFileSync("node", ["build-config.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: { ...process.env, API_BASE_URL: PRODUCTION_API_BASE_URL },
    });
    const generatedConfig = readFileSync(configUrl, "utf8");
    assert.match(generatedConfig, new RegExp(PRODUCTION_API_BASE_URL.replaceAll(".", "\\.")));
    assert.doesNotMatch(generatedConfig, /http:\/\/localhost:8000/);
  } finally {
    writeFileSync(configUrl, originalConfig);
  }
});
