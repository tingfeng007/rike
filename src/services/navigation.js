const tabs = new Set(['home', 'oral', 'reader', 'nce', 'vocab', 'dictionary', 'settings']);
export function parseLearningRoute(hash = '') {
  const [path, search = ''] = String(hash).replace(/^#\/?/, '').split('?');
  if (!tabs.has(path)) return null;
  const params = new URLSearchParams(search);
  const options = {};
  for (const key of ['articleId', 'lesson', 'scenarioId', 'query', 'section', 'entry', 'lineId']) {
    const value = params.get(key);
    if (value && value.length <= 250) options[key] = value;
  }
  return { tab: path, options };
}
export function formatLearningRoute(tab, options = {}) {
  const valid = tabs.has(tab) ? tab : 'home';
  const params = new URLSearchParams();
  for (const key of ['articleId', 'lesson', 'scenarioId', 'query', 'section', 'entry', 'lineId']) {
    if (typeof options[key] === 'string' && options[key]) params.set(key, options[key]);
  }
  return `#/${valid}${params.size ? `?${params}` : ''}`;
}
