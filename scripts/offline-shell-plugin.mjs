import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Precache every emitted chunk so pages never visited online still open offline.
export function offlineShellPlugin() {
  return {
    name: 'lingoflow-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = ['index.html', 'icon.svg', 'manifest.json', ...Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name))];
      const template = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(template + JSON.stringify(assets)).digest('hex').slice(0, 12);
      const source = template.replace("'lingoflow-offline-v11'", JSON.stringify(`lingoflow-offline-${version}`))
        .replace('/* BUILD_SHELL */ []', JSON.stringify(assets.map((name) => `./${name}`)));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
