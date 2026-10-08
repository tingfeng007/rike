const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const identity = (item) => item && typeof item === 'object'
  ? (typeof item.word === 'string' ? item.word.toLowerCase() : '') || item.id || item.sentence
  : typeof item === 'string' ? item : null;

// A three-way merge preserves changes made in another tab after the caller read its snapshot.
// A simultaneous change to the same scalar is reported, so the losing value can be recovered.
export function mergeStorageSnapshots(base, local, remote, onConflict = () => {}, path = '') {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (Array.isArray(local) && Array.isArray(remote)) {
    if (![...local, ...remote].every((item) => identity(item) != null)) return local;
    const maps = [base, local, remote].map((items) => new Map((Array.isArray(items) ? items : []).map((item) => [identity(item), item])));
    return [...new Set([...maps[1].keys(), ...maps[2].keys()])].flatMap((key) => {
      const [before, ours, theirs] = maps.map((map) => map.get(key));
      if (ours === undefined && before !== undefined) return equal(theirs, before) ? [] : [theirs];
      if (theirs === undefined && before !== undefined) return equal(ours, before) ? [] : [ours];
      if (ours === undefined) return [theirs];
      if (theirs === undefined) return [ours];
      return [mergeStorageSnapshots(before, ours, theirs, onConflict, `${path}/${key}`)];
    });
  }
  if (object(local) && object(remote)) {
    const before = object(base) ? base : {};
    return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(remote)])].flatMap((key) => {
      const merged = mergeStorageSnapshots(before[key], local[key], remote[key], onConflict, `${path}/${key}`);
      return merged === undefined ? [] : [[key, merged]];
    }));
  }
  onConflict({ path, local, remote });
  return local;
}

export function connectionOrigin(value) {
  try { return new URL(String(value || '')).origin; } catch { return ''; }
}

export const CONNECTION_FIELDS = new Set(['provider', 'apiKey', 'baseUrl', 'model', 'speechMode', 'speechApiKey', 'speechBaseUrl', 'speechModel', 'speechVoice', 'speechInstructions']);

export function mergeImportedSettings(current, incoming, includeConnections = false) {
  const preferences = Object.fromEntries(Object.entries(incoming).filter(([key]) => !CONNECTION_FIELDS.has(key)));
  if (!includeConnections) return { ...current, ...preferences };
  const merged = { ...current, ...incoming };
  for (const [urlField, keyField] of [['baseUrl', 'apiKey'], ['speechBaseUrl', 'speechApiKey']]) {
    const incomingKey = typeof incoming[keyField] === 'string' ? incoming[keyField].trim() : '';
    const sameOrigin = connectionOrigin(current[urlField]) === connectionOrigin(merged[urlField]);
    merged[keyField] = incomingKey || (sameOrigin ? current[keyField] || '' : '');
  }
  return merged;
}
