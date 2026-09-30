// Only foreground, recently active time counts; pauses never become study time.
export function createActivityClock(now = Date.now, idleMs = 60000) {
  let last = now();
  let activeUntil = last + idleMs;
  let visible = true;
  let elapsed = 0;
  const tick = () => {
    const time = now();
    if (visible) elapsed += Math.max(0, Math.min(time, activeUntil) - last);
    last = time;
  };
  return {
    activity() { tick(); activeUntil = now() + idleMs; },
    setVisible(value) { tick(); visible = value; if (value) activeUntil = now() + idleMs; },
    takeMinutes() { tick(); const minutes = elapsed / 60000; elapsed = 0; return Number(minutes.toFixed(3)); },
  };
}
