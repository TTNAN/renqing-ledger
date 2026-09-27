/**
 * 人情账 · 主应用
 *
 * 负责三件事：
 *   1. 启动流程（读数据 / 判断要不要解锁 / 跑自动备份）
 *   2. 顶部导航 + 页面分发
 *   3. 字号与白事主题这类全局外观
 */

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useRoute, type Route } from '@/ui/router';
import { Toasts } from '@/ui/components/common';
import { MobileNav } from '@/ui/components/MobileNav';
import { HomePage } from '@/ui/pages/HomePage';
import { QuickAddPage } from '@/ui/pages/QuickAddPage';
import { SuggestPage } from '@/ui/pages/SuggestPage';
import { ContactsPage, ContactDetailPage } from '@/ui/pages/ContactsPage';
import { EventsPage, EventDetailPage } from '@/ui/pages/EventsPage';
import { StatsPage } from '@/ui/pages/StatsPage';
import { SettingsPage, BackupPage } from '@/ui/pages/SettingsPage';
import { isAndroid, migrateHint, thisDevice } from '@/platform';

export default function App() {
  const [route, go] = useRoute();

  const ledger = useStore((s) => s.ledger);
  const loading = useStore((s) => s.loading);
  const locked = useStore((s) => s.locked);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const boot = useStore((s) => s.boot);
  const runAutoBackup = useStore((s) => s.runAutoBackup);

  /* 启动 */
  useEffect(() => {
    void boot();
  }, [boot]);

  /* 数据就绪后跑一次自动备份（内部保证一天只备一次） */
  useEffect(() => {
    if (ledger && !locked) void runAutoBackup();
  }, [ledger, locked, runAutoBackup]);

  /**
   * 安卓返回键：
   *   弹窗打开 → 先关弹窗
   *   二级页   → 返回上一页
   *   首页     → 再按一次退出（第一次给提示）
   *
   * Capacitor 的 App 插件会接管物理返回键。浏览器/桌面端不会加载这个插件，
   * 所以这段是安全的空操作。
   */
  useEffect(() => {
    if (!isAndroid()) return;

    let remove: (() => void) | undefined;
    let lastBackAt = 0;

    void (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const handle = await CapApp.addListener('backButton', () => {
          // 弹窗打开时先关弹窗
          const mask = document.querySelector('.modal-mask');
          if (mask) {
            const close = mask.querySelector('.modal-close') as HTMLElement | null;
            if (close) {
              close.click();
              return;
            }
          }

          const hash = window.location.hash || '#/';
          const isHome = hash === '#/' || hash === '' || hash === '#';

          if (!isHome) {
            window.history.back();
            return;
          }

          // 已经在首页：两次返回退出
          const now = Date.now();
          if (now - lastBackAt < 2000) {
            void CapApp.exitApp();
          } else {
            lastBackAt = now;
            useStore.getState().toast('再按一次返回键退出', 'warn');
          }
        });
        remove = () => void handle.remove();
      } catch {
        /* 插件不可用就不接管 */
      }
    })();

    return () => remove?.();
  }, []);

  /* 字号倍率 */
  const fontScale = ledger?.settings.font_scale ?? 1;
  useEffect(() => {
    document.documentElement.style.setProperty('--fs', `${16 * fontScale}px`);
  }, [fontScale]);

  /* 白事场次降低喜庆配色 */
  const sombre = (() => {
    if (!ledger) return false;
    if (route.name !== 'event') return false;
    const ev = ledger.events.find((e) => e.id === route.id);
    return ev?.type === '白事' || ev?.type === '探病';
  })();

  useEffect(() => {
    document.body.classList.toggle('theme-sombre', sombre);
  }, [sombre]);

  /* ---------------- 启动中 ---------------- */
  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <div>正在打开本机账本…</div>
      </div>
    );
  }

  /* ---------------- 需要解锁 ---------------- */
  if (locked) {
    return <LockScreen />;
  }

  /* ---------------- 正常界面 ---------------- */
  const activeTab =
    route.name === 'contacts' || route.name === 'contact'
      ? 'contacts'
      : route.name === 'events' || route.name === 'event'
        ? 'events'
        : route.name === 'stats'
          ? 'stats'
          : route.name === 'settings' || route.name === 'backup'
            ? 'settings'
            : 'home';

  return (
    <div className={`app${sombre ? ' theme-sombre' : ''}`}>
      {/*
        安卓端不显示顶栏。

        原因：顶栏里只有「人情账」标题和「记一笔」按钮，
        而这两样在手机上都有替代 ——
        标题在首页大标题里已经有了，记一笔在底部导航里。
        留着只是白占一行高度，还挤掉内容区。
        浏览器与桌面端保留（那两端的顶栏含完整导航，是必需的）。
      */}
      {!isAndroid() && (
        <header className="topbar no-print">
          <div className="topbar-inner">
            <div className="brand">
              人情账
              <small>本地往来礼金账本</small>
            </div>

            <nav className="nav">
              <NavBtn active={activeTab} id="home" go={go} route={{ name: 'home' }}>
                首页
              </NavBtn>
              <NavBtn active={activeTab} id="events" go={go} route={{ name: 'events' }}>
                场次
              </NavBtn>
              <NavBtn active={activeTab} id="contacts" go={go} route={{ name: 'contacts' }}>
                户头
              </NavBtn>
              <NavBtn active={activeTab} id="stats" go={go} route={{ name: 'stats' }}>
                统计
              </NavBtn>
              <NavBtn active={activeTab} id="settings" go={go} route={{ name: 'settings' }}>
                设置
              </NavBtn>
            </nav>

            <button
              className="btn sm primary no-print"
              onClick={() => go({ name: 'quick-add' })}
            >
              记一笔
            </button>
          </div>
        </header>
      )}

      <main className="main">
        <Page route={route} go={go} />
      </main>

      <footer className="footer no-print">
        {`人情账 · 数据只保存在${thisDevice()}上，不联网、不上传、不需要账号。`}
        <br />
        {migrateHint()}
        还礼建议只是历史参考，最终请按当地风俗和家中长辈的意见来。
      </footer>

      {/* 手机底部导航；宽屏由 CSS 隐藏 */}
      <MobileNav route={route} go={go} />

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/* ------------------------------------------------------------------ 导航按钮 */

function NavBtn({
  active,
  id,
  go,
  route,
  children,
}: {
  active: string;
  id: string;
  go: (r: Route) => void;
  route: Route;
  children: React.ReactNode;
}) {
  return (
    <button className={active === id ? 'on' : ''} onClick={() => go(route)}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ 页面分发 */

function Page({ route, go }: { route: Route; go: (r: Route) => void }) {
  switch (route.name) {
    case 'home':
      return <HomePage go={go} />;
    case 'quick-add':
      return <QuickAddPage go={go} initialEventId={route.eventId} />;
    case 'suggest':
      return <SuggestPage go={go} initialContactId={route.contactId} />;
    case 'contacts':
      return <ContactsPage go={go} />;
    case 'contact':
      return <ContactDetailPage id={route.id} go={go} />;
    case 'events':
      return <EventsPage go={go} />;
    case 'event':
      return <EventDetailPage id={route.id} go={go} />;
    case 'stats':
      return <StatsPage go={go} />;
    case 'settings':
      return <SettingsPage go={go} />;
    case 'backup':
      return <BackupPage go={go} />;
    default:
      return <HomePage go={go} />;
  }
}

/* ------------------------------------------------------------------ 解锁页 */

function LockScreen() {
  const unlock = useStore((s) => s.unlock);
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pwd || busy) return;
    setBusy(true);
    setError('');
    const ok = await unlock(pwd);
    setBusy(false);
    if (!ok) {
      setError('密码不对，再试一次');
      setPwd('');
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="seal">礼</div>
        <h1>人情账</h1>
        <p className="small muted" style={{ marginTop: 0 }}>
          这本账已加密，请输入密码
        </p>

        <input
          className="input"
          type="password"
          value={pwd}
          autoFocus
          placeholder="密码"
          style={{ textAlign: 'center', marginTop: 18 }}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />

        {error ? (
          <div className="notice danger" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <button
          className="btn primary lg"
          style={{ width: '100%', marginTop: 16 }}
          disabled={!pwd || busy}
          onClick={() => void submit()}
        >
          {busy ? '正在解锁…' : '解锁'}
        </button>

        <div className="hint" style={{ marginTop: 14 }}>
          密码只在你本机校验，不会发送到任何地方。
          <br />
          忘了密码无法找回，只能从之前导出的备份恢复。
        </div>
      </div>
    </div>
  );
}
