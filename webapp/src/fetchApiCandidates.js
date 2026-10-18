import { fetchApiResponse } from "./fetchApiResponse.js";

function timeoutError() {
  const error = new Error("request_timeout");
  error.name = "TimeoutError";
  return error;
}

// One deadline includes all fallback hosts and reading the response body.
// Only connection failures may try another host; HTTP responses are returned as-is.
export async function fetchApiCandidates(urls, options, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (const url of urls) {
    if (options.signal?.aborted)
      throw (
        options.signal.reason || new DOMException("Cancelled", "AbortError")
      );
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    try {
      return await fetchApiResponse(url, options, remaining);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      // Never repeat a timed out write: the server may have already processed it.
      if (error.name === "TimeoutError" && options.method !== "GET")
        throw error;
    }
  }
  throw lastError || new Error("network_error");
}
