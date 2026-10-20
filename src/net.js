const REQUEST_TIMEOUT_MS = 60000;
const STREAM_IDLE_MS = 90000;

function describeNetworkError(error, timeoutMs) {
  if (error && error.name === 'AbortError') {
    return new Error(`Tossive backend did not respond within ${Math.round(timeoutMs / 1000)}s. The server may be waking up or down. Try again, or run "Tossive: Check Backend Connection".`);
  }
  const cause = error && error.cause;
  const detail = (cause && (cause.code || cause.message)) || (error && error.message) || 'unknown error';
  return new Error(`Could not reach the Tossive backend (${detail}). Check your internet, VPN or proxy, then run "Tossive: Check Backend Connection".`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw describeNetworkError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

function readWithIdleTimeout(reader, ms = STREAM_IDLE_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error('The Tossive backend stopped sending the reply. Please try again.'));
    }, ms);
  });
  return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
}

module.exports = { fetchWithTimeout, readWithIdleTimeout };
