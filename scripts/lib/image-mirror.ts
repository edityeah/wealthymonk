import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

/**
 * Mirror a (possibly expiring) Notion image URL to public/img/generated/ and
 * return a stable /img/generated/... path. On any failure, returns the original
 * URL unchanged so the build still ships.
 */
const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'public', 'img', 'generated');
const FETCH_TIMEOUT_MS = 20_000;

const cache = new Map<string, string>();
export const mirrorFailures: { url: string; slug: string; reason: string }[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extFromUrl(url: string, contentType?: string): string {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    if (ext && /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(ext)) return ext;
  } catch { /* fall through */ }
  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('svg')) return '.svg';
  if (contentType?.includes('avif')) return '.avif';
  return '.jpg';
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

export async function mirrorImage(srcUrl: string, slug: string): Promise<string> {
  const cacheKey = `${slug}::${srcUrl}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  let u: URL;
  try {
    u = new URL(srcUrl);
  } catch {
    mirrorFailures.push({ url: srcUrl, slug, reason: 'invalid URL' });
    cache.set(cacheKey, srcUrl);
    return srcUrl;
  }

  const hash = createHash('sha1').update(`${u.origin}${u.pathname}`).digest('hex').slice(0, 16);
  let ext = extFromUrl(srcUrl);
  const safeSlug = slug || 'misc';
  const dir = join(OUT_DIR, safeSlug);
  await mkdir(dir, { recursive: true });
  let publicPath = `/img/generated/${safeSlug}/${hash}${ext}`;
  let filePath = join(dir, `${hash}${ext}`);

  if (await exists(filePath)) {
    cache.set(cacheKey, publicPath);
    return publicPath;
  }

  try {
    const res = await fetchWithTimeout(srcUrl, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      mirrorFailures.push({ url: srcUrl, slug, reason: `HTTP ${res.status}` });
      cache.set(cacheKey, srcUrl);
      return srcUrl;
    }
    const ct = res.headers.get('content-type') ?? undefined;
    ext = extFromUrl(srcUrl, ct);
    publicPath = `/img/generated/${safeSlug}/${hash}${ext}`;
    filePath = join(dir, `${hash}${ext}`);
    await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
    cache.set(cacheKey, publicPath);
    return publicPath;
  } catch (err: any) {
    const reason = err?.code ?? err?.name ?? err?.message ?? 'unknown';
    mirrorFailures.push({ url: srcUrl, slug, reason: String(reason) });
    cache.set(cacheKey, srcUrl);
    return srcUrl;
  }
}
