import { useEffect, useState } from 'react';
import { createActivityClock } from '../services/activityClock.js';

export function useStudyClock() {
  const [clock] = useState(() => createActivityClock());
  useEffect(() => {
    const activity = () => clock.activity();
    const visibility = () => clock.setVisible(document.visibilityState !== 'hidden');
    visibility();
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((event) => document.addEventListener(event, activity, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', visibility);
    return () => {
      events.forEach((event) => document.removeEventListener(event, activity, true));
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clock]);
  return clock;
}
