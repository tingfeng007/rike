/**
 * 渲染环境 shim：让页面组件能在 Node 里被 react-dom/server 真实渲染。
 *
 * 目的：把「页面一打开就报错」这类问题变成一条测试。真实 DOM 行为不做模拟，
 * 只提供渲染期会读到的最小环境（localStorage / window / document / navigator）。
 */
export const noop = () => {};

export function installRenderEnv() {
  const defineGlobal = (name, value) => {
    try {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    } catch {
      // 只读全局（如新版 Node 的 navigator）忽略即可
    }
  };

  const store = new Map();
  const localStorageShim = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };

  defineGlobal('localStorage', localStorageShim);
  defineGlobal('window', {
    localStorage: localStorageShim,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    location: { reload: noop, href: 'http://localhost/', origin: 'http://localhost' },
    confirm: () => true,
    alert: noop,
    scrollTo: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2,
  });
  defineGlobal('navigator', { onLine: true, userAgent: 'node', language: 'zh-CN', languages: ['zh-CN'] });
  defineGlobal('document', {
    createElement: () => ({
      style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop,
      removeEventListener: noop, classList: { add: noop, remove: noop },
    }),
    createTextNode: () => ({}),
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    hidden: false,
    visibilityState: 'visible',
    body: { style: {}, appendChild: noop, classList: { add: noop, remove: noop } },
    head: { appendChild: noop },
    documentElement: { style: {}, classList: { add: noop, remove: noop } },
    activeElement: null,
  });
  defineGlobal('CSS', { supports: () => false });
  defineGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
  defineGlobal('cancelAnimationFrame', (id) => clearTimeout(id));

  return { localStorageShim };
}
