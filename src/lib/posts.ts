import { getCollection, type CollectionEntry } from 'astro:content';
import { slugifyTag } from './categories.ts';

export type Post = CollectionEntry<'posts'>;

const isProd = import.meta.env.PROD;

/** All non-draft posts, newest first. */
export async function getAllPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => !(isProd && data.draft));
  return posts.sort(
    (a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf(),
  );
}

export function postSlug(post: Post): string {
  return post.data.slug ?? post.id.replace(/^.*\//, '').replace(/\.mdx?$/, '');
}

export async function getPostsByCategory(category: string): Promise<Post[]> {
  return (await getAllPosts()).filter((p) => p.data.category === category);
}

export async function getPostsByTag(tagSlug: string): Promise<Post[]> {
  return (await getAllPosts()).filter((p) =>
    (p.data.tags ?? []).some((t) => slugifyTag(t) === tagSlug),
  );
}

/** All distinct tags with their post counts. */
export async function getAllTags(): Promise<{ tag: string; slug: string; count: number }[]> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const p of await getAllPosts()) {
    for (const t of p.data.tags ?? []) {
      const slug = slugifyTag(t);
      const cur = counts.get(slug);
      if (cur) cur.count++;
      else counts.set(slug, { tag: t, count: 1 });
    }
  }
  return [...counts.entries()]
    .map(([slug, v]) => ({ slug, tag: v.tag, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

/** Posts in a series, ordered by seriesOrder. */
export async function getSeries(name: string): Promise<Post[]> {
  return (await getAllPosts())
    .filter((p) => p.data.series === name)
    .sort((a, b) => (a.data.seriesOrder ?? 0) - (b.data.seriesOrder ?? 0));
}

/** Previous/next chapter within a post's series. */
export async function getAdjacentInSeries(
  post: Post,
): Promise<{ prev: Post | null; next: Post | null }> {
  if (!post.data.series) return { prev: null, next: null };
  const series = await getSeries(post.data.series);
  const i = series.findIndex((p) => postSlug(p) === postSlug(post));
  return {
    prev: i > 0 ? series[i - 1] : null,
    next: i >= 0 && i < series.length - 1 ? series[i + 1] : null,
  };
}
