const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://localhost:8000";

async function checkHealth() {
  const target = document.getElementById("healthStatus");
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error("API returned an error");
    }
    const payload = await response.json();
    target.textContent = `${payload.status.toUpperCase()} - ${payload.service}`;
    target.className = "health ok";
  } catch (error) {
    target.textContent = "API not connected";
    target.className = "health error";
  }
}

checkHealth();

