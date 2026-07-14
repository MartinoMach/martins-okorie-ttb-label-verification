import { writeFileSync } from "node:fs";

const LOCAL_API_BASE_URL = "http://localhost:8000";
const PRODUCTION_API_BASE_URL = "https://ttb-label-verification-api-zgnb.onrender.com";

const isProductionBuild = process.env.VERCEL || process.env.NODE_ENV === "production";
const apiBaseUrl = process.env.API_BASE_URL || (isProductionBuild ? PRODUCTION_API_BASE_URL : LOCAL_API_BASE_URL);

writeFileSync(
  new URL("./config.js", import.meta.url),
  `window.APP_CONFIG = {\n  API_BASE_URL: ${JSON.stringify(apiBaseUrl)}\n};\n`
);
