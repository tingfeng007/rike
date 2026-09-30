// A closed or replaced lookup must never apply a late result to another word.
export function createLatestRequest() {
  let controller;
  return {
    cancel() { controller?.abort(); controller = undefined; },
    start() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      return { signal: current.signal, isCurrent: () => controller === current && !current.signal.aborted };
    },
  };
}
