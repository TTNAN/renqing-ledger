/**
 * 人情账 · 场次（列表 + 详情 + 礼簿）
 *
 * 「我家办事」的场次可以生成礼簿，A4 打印给长辈看，
 * 也可以导出 CSV 给 Excel。
 */

import { useEffect, useMemo, useState } from 'react';
import { formatCN, todayISO } from '@/domain/date';
import { buildLedgerSheet, entriesToCSV, ledgerSheetToText } from '@/domain/export';
import { formatCents } from '@/domain/money';
import { imagesToPdf } from '@/domain/pdf';
import { canvasToJpeg, canvasToPng, paginateSheet, renderSheetPage } from '@/domain/sheetCanvas';
import { totalsOf } from '@/domain/stats';
import { EVENT_TYPES, HOST_SIDE_LABEL, isSombre } from '@/domain/types';
import type { Entry, Event, EventType, HostSide } from '@/domain/types';
import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';
import {
  ConfirmModal,
  EmptyState,
  Field,
  Modal,
  Segmented,
} from '@/ui/components/common';
import { downloadText } from '@/storage/repo';
import { emptyEventHint, isAndroid, isDesktop, saveBinaryFile, tableFileName } from '@/platform';
import { LedgerNotReady } from '@/ui/components/LedgerNotReady';

/* ================================================================== 列表 */

export function EventsPage({ go }: { go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const addEvent = useStore((s) => s.addEvent);
  const toast = useStore((s) => s.toast);

  const [creating, setCreating] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all');
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');

  const events = useMemo(() => {
    if (!ledger) return [];
    let list = ledger.events
      .filter((e) => !e.deleted_at)
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (typeFilter !== 'all') list = list.filter((e) => e.type === typeFilter);
    if (yearFilter !== 'all') {
      list = list.filter((e) => Number(String(e.date).slice(0, 4)) === yearFilter);
    }
    return list;
  }, [ledger, typeFilter, yearFilter]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const e of ledger?.events ?? []) {
      if (e.deleted_at) continue;
      set.add(Number(String(e.date).slice(0, 4)));
    }
    return [...set].sort((a, b) => b - a);
  }, [ledger]);

  const statOf = (ev: Event) => {
    const list = (ledger?.entries ?? []).filter((e) => !e.deleted_at && e.event_id === ev.id);
    return totalsOf(list.map((entry) => ({ entry, event: ev, contact: null })));
  };

  if (!ledger) return <LedgerNotReady go={go} />;

  return (
    <>
      <div className="page-head row-between">
        <div>
          <h1>场次</h1>
          <p>一次红白喜事就是一场。共 {events.length} 场。</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          ＋ 新建场次
        </button>
      </div>

      <div className="card">
        <div className="row-between">
          <div className="chips">
            <button
              className={`chip${typeFilter === 'all' ? ' on' : ''}`}
              onClick={() => setTypeFilter('all')}
            >
              全部类型
            </button>
            {EVENT_TYPES.map((t) => (
              <button
                key={t}
                className={`chip${typeFilter === t ? ' on' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {years.length > 1 ? (
            <select
              className="select"
              style={{ width: 'auto' }}
              value={yearFilter === 'all' ? 'all' : String(yearFilter)}
              onChange={(e) =>
                setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
            >
              <option value="all">全部年份</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y} 年
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {events.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="🗓"
            title={typeFilter === 'all' ? '还没有场次' : `没有「${typeFilter}」的场次`}
            action={
              <button className="btn primary" onClick={() => setCreating(true)}>
                新建场次
              </button>
            }
          >
            场次就是一次办事：谁家结婚、满月、乔迁、白事。记一笔的时候也能顺手建。
          </EmptyState>
        </div>
      ) : (
        <div className="card tight">
          <div className="list">
            {events.map((ev) => {
              const t = statOf(ev);
              const net = t.receive - t.give;
              return (
                <button
                  key={ev.id}
                  className="list-item"
                  onClick={() => go({ name: 'event', id: ev.id })}
                >
                  <div className="mid">
                    <div className="title">
                      {ev.title}
                      <span className={`tag${isSombre(ev.type) ? ' sombre' : ''}`}>
                        {ev.type}
                      </span>
                      {ev.host_side === 'self' ? (
                        <span className="tag self">我家办事</span>
                      ) : null}
                    </div>
                    <div className="meta">
                      {formatCN(ev.date)} · {t.count} 笔
                      {ev.location ? ` · ${ev.location}` : ''}
                    </div>
                  </div>
                  <div className="right">
                    {t.give > 0 ? (
                      <div className="sub amt-give">随出 {formatCents(t.give, { symbol: false })}</div>
                    ) : null}
                    {t.receive > 0 ? (
                      <div className="sub amt-receive">
                        收来 {formatCents(t.receive, { symbol: false })}
                      </div>
                    ) : null}
                    <div className="sub muted">净额 {formatCents(net, { symbol: false })}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {creating ? (
        <EventFormModal
          onClose={() => setCreating(false)}
          onSave={(input) => {
            const ev = addEvent(input);
            setCreating(false);
            toast('场次已建好');
            go({ name: 'event', id: ev.id });
          }}
        />
      ) : null}
    </>
  );
}

/* ================================================================== 详情 */

export function EventDetailPage({ id, go }: { id: string; go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const deleteEvent = useStore((s) => s.deleteEvent);
  const deleteEntry = useStore((s) => s.deleteEntry);
  const toast = useStore((s) => s.toast);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<Entry | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  /** 正在生成什么：null 空闲，'pdf' / 'img' 用于禁用按钮并显示进度 */
  const [busy, setBusy] = useState<null | 'pdf' | 'img'>(null);
  /**
   * 礼簿预览图（每页一张 data URL）。
   *
   * 预览直接用 Canvas 渲染的结果，而不是 HTML 表格 ——
   * 这样「屏幕上看到的 = 打印出来的 = 存出来的 PDF/图片」，
   * 三处永远一致。之前预览是 HTML 表格、导出走 Canvas，
   * 两条路径的排版差异会导致「预览好好的、导出却截断」这类问题。
   */
  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const event = ledger?.events.find((e) => e.id === id && !e.deleted_at) ?? null;

  const entries = useMemo(() => {
    if (!ledger || !event) return [];
    return ledger.entries
      .filter((e) => !e.deleted_at && e.event_id === event.id)
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }, [ledger, event]);

  const totals = totalsOf(entries.map((entry) => ({ entry, event, contact: null })));

  if (!ledger) return <LedgerNotReady go={go} />;

  if (!event) {
    return (
      <div className="card">
        <EmptyState
          icon="🤷"
          title="这个场次不存在"
          action={
            <button className="btn" onClick={() => go({ name: 'events' })}>
              返回场次列表
            </button>
          }
        />
      </div>
    );
  }

  const contactName = (cid: string) =>
    ledger.contacts.find((c) => c.id === cid)?.display_name ?? '（已删除的户头）';

  const sombre = isSombre(event.type);

  const sheet = buildLedgerSheet(event, ledger.entries, ledger.contacts, ledger.household.name);

  /** 闭包里 event 的窄化会丢，这里固定成一个非空引用 */
  const ev = event;

  async function exportCSV() {
    const csv = entriesToCSV(entries, [ev], ledger!.contacts);
    const r = await downloadText(tableFileName(`${ev.title}-明细`, 'csv'), csv, 'text/csv');
    if (r.canceled) return;
    toast(r.ok ? (r.where ?? 'CSV 已导出') : '导出失败：' + (r.error ?? ''), r.ok ? 'ok' : 'error');
  }

  function copyLedgerText() {
    const text = ledgerSheetToText(sheet);
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(
        () => toast('礼簿文本已复制，可以贴到微信'),
        () => toast('复制失败，可以改用导出', 'warn'),
      );
    } else {
      toast('这个浏览器不支持复制，请用导出', 'warn');
    }
  }

  /**
   * 把礼簿渲染成图片（多页时返回多张）。
   *
   * 三端共用的准备工作：
   *   PDF 与图片导出都先走这一步，
   *   保证同一个礼簿在两处长得一模一样。
   */
  async function renderPages() {
    const pages = paginateSheet(sheet);
    const images: Array<{ data: Uint8Array; width: number; height: number }> = [];
    const canvases: HTMLCanvasElement[] = [];

    for (const p of pages) {
      const canvas = renderSheetPage(sheet, p, {
        household: sheet.household,
        totalText: sheet.totalText,
        totalCount: sheet.count,
      });
      canvases.push(canvas);
      images.push({
        data: await canvasToJpeg(canvas),
        width: canvas.width,
        height: canvas.height,
      });
    }
    return { pages, images, canvases };
  }

  /**
   * 弹窗打开时先把预览图渲染出来。
   *
   * 预览用的是导出时同一份 Canvas 输出，
   * 所以「所见即所得」——屏幕上什么样，存出来就什么样。
   * 渲染是异步的（要等 canvas.toBlob），所以先显示「正在生成」。
   */
  useEffect(() => {
    if (!showLedger) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }

    let canceled = false;
    setPreview(null);
    setPreviewErr(null);

    void (async () => {
      try {
        const pages = paginateSheet(sheet);
        const urls: string[] = [];
        for (const p of pages) {
          const canvas = renderSheetPage(sheet, p, {
            household: sheet.household,
            totalText: sheet.totalText,
            totalCount: sheet.count,
          });
          urls.push(canvas.toDataURL('image/png'));
        }
        if (!canceled) setPreview(urls);
      } catch (e) {
        if (!canceled) {
          setPreviewErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      canceled = true;
    };
    // sheet 由 ledger 派生，ledger 变化时重算；其余是稳定的展示参数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLedger, sheet]);

  /**
   * 导出 PDF。
   *
   * 三端都走这里：
   *   手机与桌面 → 写成文件存到本机（安卓是 App 文档目录）
   *   浏览器     → 触发下载
   *
   * 手机上不能用 window.print() —— 安卓 WebView 没有打印子系统，
   * 那是空操作，点了完全没反应。
   */
  async function exportPdf() {
    if (busy) return;
    setBusy('pdf');
    try {
      const { pages, images } = await renderPages();
      const data = imagesToPdf(images, { title: `${sheet.title} 礼簿` });

      const name = `${sheet.title}-礼簿.pdf`;
      const r = await saveBinaryFile(name, data, 'application/pdf');

      if (r.ok) {
        const where = r.where ? `，${r.where}` : '';
        toast(
          pages.length > 1
            ? `已保存「${name}」（共 ${pages.length} 页）${where}`
            : `已保存「${name}」${where}`,
          'ok',
        );
      } else {
        toast('保存失败：' + (r.error ?? '未知原因'), 'error');
      }
    } catch (e) {
      toast('生成 PDF 失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(null);
    }
  }

  /**
   * 导出图片（PNG）。
   *
   * 多页时逐张存 —— 手机上分享到微信、贴到群里，
   * 图片比 PDF 更方便（不用对方装阅读器）。
   */
  async function exportImages() {
    if (busy) return;
    setBusy('img');
    try {
      const { pages, canvases } = await renderPages();
      const base = `${sheet.title}-礼簿`;

      /*
       * 多页时文件名带页码；单页就不带，免得看着啰嗦。
       *
       * 浏览器对「短时间内连续触发多次下载」会拦截，
       * 所以每张之间留一点间隔 —— 桌面上是弹多次保存框，
       * 安卓是逐次写入，都不需要这个间隔，但加上无害。
       */
      for (let i = 0; i < canvases.length; i += 1) {
        if (i > 0) await new Promise((r) => setTimeout(r, 450));

        const suffix = canvases.length > 1 ? `-第${i + 1}页` : '';
        const name = `${base}${suffix}.png`;
        const png = await canvasToPng(canvases[i]!);
        const r = await saveBinaryFile(name, png, 'image/png');
        if (!r.ok) {
          toast(`第 ${i + 1} 张保存失败：` + (r.error ?? '未知原因'), 'error');
          return;
        }
      }

      toast(
        pages.length > 1
          ? `已保存 ${pages.length} 张图片`
          : '图片已保存，可直接发给家人',
        'ok',
      );
    } catch (e) {
      toast('生成图片失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(null);
    }
  }

  /**
   * 打印。
   *
   * 关键：不再依赖 CSS 打印样式，而是把 Canvas 渲染好的图片
   * 塞进一个专用打印容器再调 window.print()。
   *
   * 为什么这么改：
   *   原来打印走的是 @media print + HTML 表格，
   *   与「存 PDF」走的 Canvas 渲染是两条完全不同的路径 ——
   *   同一份礼簿，打印出来和存成 PDF 长得不一样。
   *   现在共用同一份图片，两处必然一致。
   */
  function printSheet() {
    if (!preview || preview.length === 0) {
      toast('礼簿还在生成，稍等一下再打印', 'warn');
      return;
    }

    const host = document.createElement('div');
    host.id = 'print-host';
    for (const url of preview) {
      const img = document.createElement('img');
      img.src = url;
      host.appendChild(img);
    }
    document.body.appendChild(host);

    /* data URL 是同步可用的，等一帧让浏览器完成布局再打印 */
    requestAnimationFrame(() => {
      const cleanup = () => {
        host.remove();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      /* 有些浏览器不触发 afterprint，兜一层定时清理 */
      setTimeout(cleanup, 3000);
    });
  }

  return (
    <div className={sombre ? 'theme-sombre' : undefined}>
      <div className="page-head">
        <button className="btn ghost sm" onClick={() => go({ name: 'events' })}>
          ← 场次列表
        </button>
      </div>

      <div className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: '0 0 5px', fontSize: '1.35em' }}>{event.title}</h1>
            <div className="small muted">
              <span className={`tag${sombre ? ' sombre' : ''}`}>{event.type}</span>{' '}
              <span className="tag self">{HOST_SIDE_LABEL[event.host_side]}</span>{' '}
              {formatCN(event.date)}
              {event.location ? ` · ${event.location}` : ''}
            </div>
            {event.notes ? (
              <div className="notice info" style={{ marginTop: 11 }}>
                {event.notes}
              </div>
            ) : null}
          </div>

          <div className="btn-row">
            <button className="btn sm" onClick={() => setEditing(true)}>
              编辑
            </button>
            <button className="btn sm primary" onClick={() => go({ name: 'quick-add', eventId: event.id })}>
              ＋ 记一笔
            </button>
            <button className="btn sm danger" onClick={() => setConfirmDelete(true)}>
              删除
            </button>
          </div>
        </div>

        <div className="grid grid-3" style={{ marginTop: 15 }}>
          <div className="stat give" style={{ boxShadow: 'none' }}>
            <div className="k">随出合计</div>
            <div className="v">{formatCents(totals.give)}</div>
          </div>
          <div className="stat receive" style={{ boxShadow: 'none' }}>
            <div className="k">收来合计</div>
            <div className="v">{formatCents(totals.receive)}</div>
          </div>
          <div className="stat" style={{ boxShadow: 'none' }}>
            <div className="k">净额</div>
            <div className="v">{formatCents(totals.receive - totals.give)}</div>
            <div className="sub">{totals.count} 笔</div>
          </div>
        </div>
      </div>

      <div className="card tight">
        <div style={{ padding: '15px 17px 11px' }} className="row-between">
          <h3 style={{ margin: 0 }}>条目（{entries.length}）</h3>
          <div className="btn-row">
            <button className="btn sm" onClick={() => setShowLedger(true)}>
              生成礼簿
            </button>
            <button className="btn sm" onClick={exportCSV}>
              导出 CSV
            </button>
            <button className="btn sm" onClick={copyLedgerText}>
              复制文本
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty" style={{ padding: '36px 20px' }}>
            <div className="icon">📝</div>
            <h3>这场还没有条目</h3>
            <p>{emptyEventHint()}</p>
            <button
              className="btn primary"
              onClick={() => go({ name: 'quick-add', eventId: event.id })}
            >
              开始录入
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 46 }}>#</th>
                  <th>对方</th>
                  <th>方向</th>
                  <th>日期</th>
                  <th>方式</th>
                  <th>经手人</th>
                  <th>备注</th>
                  <th style={{ textAlign: 'right' }}>金额</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {entries.map((en, i) => (
                  <tr key={en.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <button
                        className="btn ghost sm"
                        style={{ padding: '2px 6px', fontWeight: 600 }}
                        onClick={() => go({ name: 'contact', id: en.contact_id })}
                      >
                        {contactName(en.contact_id)}
                      </button>
                    </td>
                    <td>
                      <span className={`tag ${en.direction}`}>
                        {en.direction === 'give' ? '随出' : '收来'}
                      </span>
                    </td>
                    <td className="nowrap small">{formatCN(en.happened_on)}</td>
                    <td className="small">{en.method ?? '—'}</td>
                    <td className="small">{en.handler ?? '—'}</td>
                    <td className="small muted">
                      {[en.goods_desc, en.notes].filter(Boolean).join('；') || '—'}
                    </td>
                    <td
                      className={`num ${en.direction === 'give' ? 'amt-give' : 'amt-receive'}`}
                    >
                      {formatCents(en.amount_cents)}
                    </td>
                    <td>
                      <button
                        className="btn ghost sm"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => setConfirmDeleteEntry(en)}
                      >
                        删
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>合计</td>
                  <td className="num">
                    {totals.give > 0 ? (
                      <span className="amt-give">{formatCents(totals.give)}</span>
                    ) : null}
                    {totals.give > 0 && totals.receive > 0 ? ' / ' : null}
                    {totals.receive > 0 ? (
                      <span className="amt-receive">{formatCents(totals.receive)}</span>
                    ) : null}
                    {totals.count === 0 ? '—' : null}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- 礼簿 ---------------- */}
      {showLedger ? (
        <Modal
          title="礼簿"
          wide
          onClose={() => setShowLedger(false)}
          footer={
            <>
              <button className="btn" onClick={copyLedgerText}>
                复制文本
              </button>
              <button className="btn" onClick={exportCSV}>
                导出 CSV
              </button>
              <div className="spacer" />
              <button className="btn" onClick={() => setShowLedger(false)}>
                关闭
              </button>
              {/*
                三端统一走同一套导出：
                  礼簿 → Canvas → PDF / PNG
                桌面与浏览器额外保留系统打印（那边 window.print() 可用，
                打印样式已按 A4 调好）。
                手机不显示打印按钮 —— 安卓 WebView 没有打印子系统，
                window.print() 是空操作，点了没反应。
              */}
              <button
                className="btn"
                onClick={() => void exportImages()}
                disabled={busy !== null}
              >
                {busy === 'img' ? '生成中…' : '存图片'}
              </button>

              {!isAndroid() ? (
                <button className="btn" onClick={printSheet} disabled={preview === null}>
                  打印
                </button>
              ) : null}

              <button
                className="btn primary"
                onClick={() => void exportPdf()}
                disabled={busy !== null}
              >
                {busy === 'pdf' ? '生成中…' : '存 PDF'}
              </button>
            </>
          }
        >
          {/*
            预览用 Canvas 渲染的图片，不是 HTML 表格。
            这样屏幕上看到的与导出/打印的完全一致 ——
            之前预览是表格、导出走 Canvas，两套排版会不一致。
          */}
          {previewErr ? (
            <div className="notice warn" style={{ marginTop: 0 }}>
              礼簿预览生成失败：{previewErr}
            </div>
          ) : preview === null ? (
            <div className="notice info" style={{ marginTop: 0 }}>
              正在生成礼簿预览…
            </div>
          ) : (
            <div className="sheet-preview">
              {preview.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`礼簿第 ${i + 1} 页`}
                  className="sheet-preview-page"
                />
              ))}
            </div>
          )}

          {/*
            说明文案按端区分：
            手机存到 App 文档目录，桌面存到选定的备份目录，
            浏览器直接下载 —— 说清去哪找文件，比笼统说「已保存」有用。
          */}
          <div className="notice info no-print" style={{ marginTop: 14 }}>
            {isAndroid()
              ? '「存 PDF」与「存图片」都会生成文件，放在手机的「文档 / RenqingLedger」里，之后可以直接用微信发给家人。超过 22 笔会自动分页。'
              : isDesktop()
                ? '「存 PDF」与「存图片」会保存到设置里指定的备份目录。也可以点「打印」调起系统打印窗口。'
                : '「存 PDF」与「存图片」会直接下载文件。也可以点「打印」，在打印窗口里选「另存为 PDF」。'}
          </div>
        </Modal>
      ) : null}

      {/* ---------------- 弹窗 ---------------- */}
      {editing ? (
        <EventFormModal
          event={event}
          onClose={() => setEditing(false)}
          onSave={(input) => {
            useStore.getState().updateEvent(event.id, input);
            setEditing(false);
            toast('已保存');
          }}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmModal
          title="删除场次"
          danger
          confirmText="删除"
          message={
            <>
              确定删除「<strong>{event.title}</strong>」吗？
              <div className="hint" style={{ marginTop: 8 }}>
                这场里的 {entries.length} 笔条目会一并标记删除，不再出现在统计里。
              </div>
            </>
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            deleteEvent(event.id);
            setConfirmDelete(false);
            toast('已删除');
            go({ name: 'events' });
          }}
        />
      ) : null}

      {confirmDeleteEntry ? (
        <ConfirmModal
          title="删除这一笔"
          danger
          confirmText="删除"
          message={
            <>
              删除 <strong>{contactName(confirmDeleteEntry.contact_id)}</strong> 的{' '}
              <strong>{formatCents(confirmDeleteEntry.amount_cents)}</strong> 吗？
            </>
          }
          onCancel={() => setConfirmDeleteEntry(null)}
          onConfirm={() => {
            deleteEntry(confirmDeleteEntry.id);
            setConfirmDeleteEntry(null);
            toast('已删除');
          }}
        />
      ) : null}
    </div>
  );
}

/* ================================================================== 表单 */

export function EventFormModal({
  event,
  onClose,
  onSave,
}: {
  event?: Event;
  onClose: () => void;
  onSave: (input: {
    title: string;
    type: EventType;
    date: string;
    host_side: HostSide;
    host_contact_id?: string | null;
    location?: string;
    notes?: string;
  }) => void;
}) {
  const ledger = useStore((s) => s.ledger);
  const contacts = (ledger?.contacts ?? []).filter((c) => !c.deleted_at);

  const [type, setType] = useState<EventType>(event?.type ?? '结婚');
  const [hostSide, setHostSide] = useState<HostSide>(event?.host_side ?? 'other');
  const [hostId, setHostId] = useState<string | null>(event?.host_contact_id ?? null);
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? todayISO());
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');

  const autoTitle =
    hostSide === 'other'
      ? `${contacts.find((c) => c.id === hostId)?.display_name ?? ''}${type}`
      : `我家${type}`;

  return (
    <Modal
      title={event ? '编辑场次' : '新建场次'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() =>
              onSave({
                title: title.trim() || autoTitle,
                type,
                date,
                host_side: hostSide,
                host_contact_id: hostId,
                location: location.trim() || undefined,
                notes: notes.trim() || undefined,
              })
            }
          >
            {event ? '保存' : '创建'}
          </button>
        </>
      }
    >
      <Field label="什么事">
        <div className="chips">
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${type === t ? ' on' : ''}`}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      <Field label="谁办事" hint="决定默认记「随出」还是「收来」">
        <Segmented<HostSide>
          value={hostSide}
          onChange={setHostSide}
          options={[
            { value: 'other', label: '对方家办事（我随出）' },
            { value: 'self', label: '我家办事（我收来）' },
          ]}
        />
      </Field>

      {hostSide === 'other' ? (
        <Field label="对方户头" hint="选了之后，记一笔时会自动锁定这个人">
          <select
            className="select"
            value={hostId ?? ''}
            onChange={(e) => setHostId(e.target.value || null)}
          >
            <option value="">— 暂不指定 —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}（{c.relation}）
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className="field-row">
        <Field label="名称" hint={`留空自动用「${autoTitle}」`}>
          <input
            className="input"
            type="text"
            value={title}
            placeholder={autoTitle}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="日期">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>

      <Field label="地点">
        <input
          className="input"
          type="text"
          value={location}
          placeholder="例：老家祠堂 / 金满堂酒店"
          onChange={(e) => setLocation(e.target.value)}
        />
      </Field>

      <Field label="备注">
        <textarea
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
