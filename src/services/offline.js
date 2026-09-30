const NCE_AUDIO_CACHE = 'lingoflow-nce-audio-v1';

export function supportsCourseCache() {
  return typeof window !== 'undefined' && 'caches' in window && typeof window.fetch === 'function';
}

export async function cacheCourseAudio(url, { signal } = {}) {
  if (!supportsCourseCache()) throw new Error('当前浏览器不支持离线音频缓存');
  const response = await fetch(url, { mode: 'cors', signal });
  if (!response.ok) throw new Error(`音频下载失败（${response.status}）`);
  const cache = await window.caches.open(NCE_AUDIO_CACHE);
  await cache.put(url, response.clone());
  return true;
}

export async function getCachedCourseAudioUrl(url) {
  if (!supportsCourseCache()) return '';
  const cache = await window.caches.open(NCE_AUDIO_CACHE);
  const response = await cache.match(url);
  if (!response) return '';
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function clearCourseCaches() {
  if (!supportsCourseCache()) return false;
  return window.caches.delete(NCE_AUDIO_CACHE);
}

export async function getCourseCacheCount() {
  if (!supportsCourseCache()) return 0;
  const cache = await window.caches.open(NCE_AUDIO_CACHE);
  const requests = await cache.keys();
  return requests.length;
}



export async function isCoursePackageReady(unit, courseCache, base = 'https://nce.mleo.site/NCE1') {
  if (!courseCache.book?.units?.length || !courseCache.lessons?.[unit.filename] || !supportsCourseCache()) return false;
  const cache = await window.caches.open(NCE_AUDIO_CACHE);
  return Boolean(await cache.match(`${base}/${encodeURIComponent(unit.filename)}.mp3`));
}
