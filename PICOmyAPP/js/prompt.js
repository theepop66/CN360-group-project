export async function sendPrompt({ fetchImpl = fetch, url, prompt, timeoutMs = 8000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`n8n returned HTTP ${response.status}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
