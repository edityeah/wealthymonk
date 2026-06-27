/** Canonical, stable identity keys for evergreen topics, e.g. visa:japan:in. */

export function slugWord(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Join already-meaningful parts into a colon key. Empty parts are dropped. */
export function canonicalKey(parts: string[]): string {
  return parts.map(slugWord).filter(Boolean).join(':');
}
