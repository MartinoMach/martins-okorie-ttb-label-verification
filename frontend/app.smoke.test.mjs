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

function batchResult() {
  return {
    items: [
      { item_id: "Label 1", result: verificationResult(), error: null },
      { item_id: "Label 2", result: verificationResult(), error: null },
    ],
    summary: { passed: 2, needs_review: 0, total: 2 },
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
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = fetchImpl;
  window.eval(app);
  return { dom, window };
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

test("Vercel build config defaults to the deployed Render API", () => {
  const configUrl = new URL("./config.js", import.meta.url);
  const originalConfig = readFileSync(configUrl, "utf8");
  try {
    execFileSync("node", ["build-config.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: { ...process.env, VERCEL: "1", API_BASE_URL: "" },
    });
    const generatedConfig = readFileSync(configUrl, "utf8");
    assert.match(generatedConfig, new RegExp(PRODUCTION_API_BASE_URL.replaceAll(".", "\\.")));
    assert.doesNotMatch(generatedConfig, /http:\/\/localhost:8000/);
  } finally {
    writeFileSync(configUrl, originalConfig);
  }
});
