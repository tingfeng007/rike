import { useEffect, useRef } from 'react';
import { StorageService } from '../services/storage.js';

/** Serialized writes preserve the newest snapshot even when an IDB transaction is delayed. */
export function useLearningSession(scope, snapshot, onError) {
  const queue = useRef(Promise.resolve());
  const report = useRef(onError);
  useEffect(() => { report.current = onError; }, [onError]);
  useEffect(() => {
    if (!snapshot) return;
    queue.current = queue.current.then(async () => {
      const saved = await StorageService.saveLearningSession(scope, snapshot);
      if (!saved) report.current?.();
    }).catch(() => report.current?.());
  }, [scope, snapshot]);
}
