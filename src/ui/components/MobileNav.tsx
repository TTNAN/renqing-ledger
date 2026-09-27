/**
 * 人情账 · 移动端导航
 *
 * 只在窄屏（手机）显示，宽屏仍用顶部导航。
 * 四个入口：首页 / 记一笔 / 还礼 / 我的
 *
 * 触控目标不小于 44px（需求硬要求），并适配刘海屏安全区。
 */

import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';

export type MobileTab = 'home' | 'add' | 'suggest' | 'me';

/** 当前路由落在哪个 tab 上 */
export function tabOf(route: Route): MobileTab {
  switch (route.name) {
    case 'quick-add':
      return 'add';
    case 'suggest':
      return 'suggest';
    case 'settings':
    case 'backup':
    case 'contacts':
    case 'contact':
      return 'me';
    default:
      return 'home';
  }
}

const ICONS: Record<MobileTab, JSX.Element> = {
  home: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
      <path d="M9.5 20.5v-6h5v6" />
    </svg>
  ),
  add: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </svg>
  ),
  suggest: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M20 12a8 8 0 1 1-3.2-6.4" />
      <path d="M20 4.5V9h-4.5" />
      <path d="M12 8v4.5l3 1.8" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" />
    </svg>
  ),
};

const LABELS: Record<MobileTab, string> = {
  home: '首页',
  add: '记一笔',
  suggest: '还礼',
  me: '我的',
};

export function MobileNav({ route, go }: { route: Route; go: (r: Route) => void }) {
  const active = tabOf(route);
  const toast = useStore((s) => s.toast);

  function tap(tab: MobileTab) {
    switch (tab) {
      case 'home':
        go({ name: 'home' });
        break;
      case 'add':
        go({ name: 'quick-add' });
        break;
      case 'suggest':
        go({ name: 'suggest' });
        break;
      case 'me':
        go({ name: 'settings' });
        break;
    }
  }

  return (
    <nav className="mobile-nav no-print" aria-label="主导航">
      {(Object.keys(LABELS) as MobileTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          className={`mobile-nav-item${active === tab ? ' on' : ''}`}
          aria-current={active === tab ? 'page' : undefined}
          onClick={() => {
            tap(tab);
            if (tab === 'me') toast('备份与设置在「我的」里', 'ok');
          }}
        >
          <span className="ico">{ICONS[tab]}</span>
          <span className="lbl">{LABELS[tab]}</span>
        </button>
      ))}
    </nav>
  );
}
