// Keep the deadline active while reading the body, not just until headers arrive.
export async function fetchApiResponse(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController(),
    external = options.signal;
  let timedOut = false;
  const abort = () => controller.abort();
  if (external?.aborted) abort();
  external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (timedOut) {
      const timeout = new Error("request_timeout");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
  }
}
