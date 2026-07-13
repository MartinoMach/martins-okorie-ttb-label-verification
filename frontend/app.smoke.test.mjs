import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("single label submit posts image and seven application fields", async () => {
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

  const fetchCalls = [];
  window.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).endsWith("/health")) {
      return new window.Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new window.Response(JSON.stringify(verificationResult()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  window.eval(app);
  await Promise.resolve();

  const form = window.document.getElementById("singleView");
  const file = new window.File(["fake-image"], "label.jpg", { type: "image/jpeg" });
  Object.defineProperty(window.document.getElementById("image"), "files", {
    configurable: true,
    value: [file],
  });

  const values = {
    brand_name: "Old Harbor",
    class_type: "Straight Bourbon Whiskey",
    abv: "45%",
    net_contents: "750 mL",
    producer: "Okorie Spirits Co.",
    country_of_origin: "United States",
    government_warning: "GOVERNMENT WARNING: sample",
  };
  for (const [name, value] of Object.entries(values)) {
    form.querySelector(`[name="${name}"]`).value = value;
  }

  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const verifyCall = fetchCalls.find((call) => String(call.url).endsWith("/verify"));
  assert.ok(verifyCall, "expected a POST /verify call");
  assert.equal(verifyCall.options.method, "POST");
  assert.ok(verifyCall.options.body instanceof window.FormData);

  const formData = verifyCall.options.body;
  assert.equal(formData.get("image"), file);
  const applicationData = JSON.parse(formData.get("application_data"));
  assert.deepEqual(Object.keys(applicationData).sort(), FIELD_NAMES.toSorted());
  assert.deepEqual(applicationData, values);
});
