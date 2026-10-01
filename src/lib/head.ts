import { SITE, type Head } from './routes';

function meta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Keep <head> in step with the page the app is showing (the build prerenders the same values). */
export function applyHead(head: Head) {
  const url = `${SITE}${head.path}`;
  if (document.title !== head.title) document.title = head.title;
  meta('name', 'description', head.description);
  meta('property', 'og:title', head.title);
  meta('property', 'og:description', head.description);
  meta('property', 'og:url', url);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
  // 404.html carries noindex; once the app has moved to a real page it no longer applies.
  document.head.querySelector('meta[name="robots"]')?.remove();
}
