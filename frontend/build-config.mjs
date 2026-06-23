import { writeFileSync } from "node:fs";

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:8000";

writeFileSync(
  new URL("./config.js", import.meta.url),
  `window.APP_CONFIG = {\n  API_BASE_URL: ${JSON.stringify(apiBaseUrl)}\n};\n`
);

