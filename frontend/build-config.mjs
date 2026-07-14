import { writeFileSync } from "node:fs";

const LOCAL_API_BASE_URL = "http://localhost:8000";

const apiBaseUrl = process.env.API_BASE_URL || LOCAL_API_BASE_URL;

writeFileSync(
  new URL("./config.js", import.meta.url),
  `window.APP_CONFIG = {\n  API_BASE_URL: ${JSON.stringify(apiBaseUrl)}\n};\n`
);
