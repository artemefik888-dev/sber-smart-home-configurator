const rawBase = import.meta.env.BASE_URL || '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

export function publicAsset(path: string) {
  if (/^(?:blob:|data:|https?:\/\/)/.test(path)) return path;
  return `${base}${path.replace(/^\/+/, '')}`;
}
