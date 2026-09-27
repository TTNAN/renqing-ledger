/**
 * 人情账 · 极简 hash 路由
 *
 * 为什么不用 react-router：
 *   九个页面、没有嵌套、没有 loader，用一个 useState + hashchange 就够了。
 *   少一个依赖，构建产物小一半，丢到 GitHub Pages 也不用配 basename。
 */

import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'quick-add'; eventId?: string }
  | { name: 'suggest'; contactId?: string }
  | { name: 'contacts' }
  | { name: 'contact'; id: string }
  | { name: 'events' }
  | { name: 'event'; id: string }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'backup' };

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'quick-add':
      return r.eventId ? `#/add?event=${encodeURIComponent(r.eventId)}` : '#/add';
    case 'suggest':
      return r.contactId ? `#/suggest?contact=${encodeURIComponent(r.contactId)}` : '#/suggest';
    case 'contacts':
      return '#/contacts';
    case 'contact':
      return `#/contact/${encodeURIComponent(r.id)}`;
    case 'events':
      return '#/events';
    case 'event':
      return `#/event/${encodeURIComponent(r.id)}`;
    case 'stats':
      return '#/stats';
    case 'settings':
      return '#/settings';
    case 'backup':
      return '#/backup';
    default:
      return '#/';
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const path = (pathPart ?? '/').replace(/^\/+|\/+$/g, '');
  const seg = path.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart ?? '');

  const head = seg[0] ?? '';
  const arg = seg[1] ? decodeURIComponent(seg[1]) : '';

  switch (head) {
    case '':
      return { name: 'home' };
    case 'add': {
      const eventId = query.get('event');
      return eventId ? { name: 'quick-add', eventId } : { name: 'quick-add' };
    }
    case 'suggest': {
      const contactId = query.get('contact');
      return contactId ? { name: 'suggest', contactId } : { name: 'suggest' };
    }
    case 'contacts':
      return { name: 'contacts' };
    case 'contact':
      return arg ? { name: 'contact', id: arg } : { name: 'contacts' };
    case 'events':
      return { name: 'events' };
    case 'event':
      return arg ? { name: 'event', id: arg } : { name: 'events' };
    case 'stats':
      return { name: 'stats' };
    case 'settings':
      return { name: 'settings' };
    case 'backup':
      return { name: 'backup' };
    default:
      return { name: 'home' };
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { name: 'home' } : parseHash(window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((r: Route) => {
    const hash = routeToHash(r);
    if (window.location.hash === hash) {
      setRoute(r);
      return;
    }
    window.location.hash = hash;
  }, []);

  return [route, navigate];
}
