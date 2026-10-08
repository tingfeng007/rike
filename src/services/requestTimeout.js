export function createTimedRequest(signal, timeoutMs = 15000) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('请求超时', 'TimeoutError')); }, timeoutMs);
  return { signal: controller.signal, get timedOut() { return timedOut; }, cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } };
}
