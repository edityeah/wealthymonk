import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllPosts, postSlug } from '../lib/posts.ts';
import { SITE } from '../lib/seo.ts';

export async function GET(context: APIContext) {
  const posts = await getAllPosts();
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.publishDate,
      description: post.data.excerpt,
      categories: post.data.category ? [post.data.category] : [],
      link: `/posts/${postSlug(post)}/`,
    })),
  });
}
