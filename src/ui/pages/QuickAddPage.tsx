/**
 * 人情账 · 记一笔（最快路径）
 *
 * 这是用得最多的页面，目标：照着一本礼簿，手不离键盘一页页打下去。
 *
 * 连续录入的关键设计：
 *   - 保存后不清空户头，只清空金额，焦点回到金额框
 *   - 户头、场次、方向、日期全部保持，下一笔直接打名字
 *   - 右上角实时显示「本次已录 N 笔 / 合计」
 *   - 回车 = 保存并继续
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { todayISO } from '@/domain/date';
import { formatCents, parseMoneyToCents } from '@/domain/money';
import { METHODS, EVENT_TYPES } from '@/domain/types';
import type { Direction, EventType, GiftKind, Method, Relation } from '@/domain/types';
import { quickAddHint, quickAddSubHint } from '@/platform';
import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';
import { Field, Segmented, EmptyState } from '@/ui/components/common';
import { ContactPicker } from '@/ui/components/ContactPicker';
import { MoneyInput } from '@/ui/components/MoneyInput';

interface SessionRow {
  key: string;
  contactName: string;
  amount: number;
  direction: Direction;
}

export function QuickAddPage({
  go,
  initialEventId,
}: {
  go: (r: Route) => void;
  initialEventId?: string;
}) {
  const ledger = useStore((s) => s.ledger);
  const addEntry = useStore((s) => s.addEntry);
  const addContact = useStore((s) => s.addContact);
  const addEvent = useStore((s) => s.addEvent);
  const toast = useStore((s) => s.toast);

  const contacts = useMemo(
    () => (ledger?.contacts ?? []).filter((c) => !c.deleted_at),
    [ledger],
  );
  const events = useMemo(
    () =>
      (ledger?.events ?? [])
        .filter((e) => !e.deleted_at)
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [ledger],
  );

  /* ---------------- 表单状态 ---------------- */
  const [eventId, setEventId] = useState<string | null>(initialEventId ?? null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('give');
  const [amount, setAmount] = useState<number | null>(null);
  const [happenedOn, setHappenedOn] = useState(todayISO());
  const [method, setMethod] = useState<Method>('现金');
  const [giftKind, setGiftKind] = useState<GiftKind>('cash');
  const [goodsDesc, setGoodsDesc] = useState('');
  const [goodsValue, setGoodsValue] = useState<number | null>(null);
  const [handler, setHandler] = useState('');
  const [notes, setNotes] = useState('');

  /* 高级选项默认收起，避免吓到只想快点录的人 */
  const [showMore, setShowMore] = useState(false);
  const [showNewEvent, setShowNewEvent] = useState(false);

  /* 连续录入的本次会话统计 */
  const [session, setSession] = useState<SessionRow[]>([]);
  const amountKey = useRef(0);

  const selectedEvent = events.find((e) => e.id === eventId) ?? null;
  const selectedContact = contacts.find((c) => c.id === contactId) ?? null;

  /* 选了场次就把日期、方向跟着场次走 */
  useEffect(() => {
    if (!selectedEvent) return;
    setHappenedOn(selectedEvent.date);
    setDirection(selectedEvent.host_side === 'self' ? 'receive' : 'give');
    // 对方主办的场次，户头直接锁定东道主
    if (selectedEvent.host_side === 'other' && selectedEvent.host_contact_id) {
      setContactId(selectedEvent.host_contact_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function resetForNext() {
    setAmount(null);
    setNotes('');
    setGoodsDesc('');
    setGoodsValue(null);
    amountKey.current += 1;
  }

  function canSave(): boolean {
    if (!eventId) return false;
    if (!contactId) return false;
    if (amount === null && giftKind === 'cash') return false;
    if (giftKind === 'goods' && !goodsDesc.trim()) return false;
    return true;
  }

  function save(continueAfter: boolean) {
    if (!eventId || !contactId) {
      toast('先选场次和对方', 'warn');
      return;
    }
    if (!canSave()) {
      toast(giftKind === 'cash' ? '金额还没填' : '礼物名称还没填', 'warn');
      return;
    }

    addEntry({
      event_id: eventId,
      contact_id: contactId,
      direction,
      amount_cents: amount ?? 0,
      gift_kind: giftKind,
      goods_desc: goodsDesc.trim() || undefined,
      goods_value_cents: goodsValue ?? undefined,
      method,
      handler: handler.trim() || undefined,
      happened_on: happenedOn,
      notes: notes.trim() || undefined,
    });

    setSession((s) => [
      ...s,
      {
        key: Math.random().toString(36).slice(2),
        contactName: selectedContact?.display_name ?? '（未命名）',
        amount: amount ?? 0,
        direction,
      },
    ]);

    if (continueAfter) {
      resetForNext();
      toast(`已记 ${selectedContact?.display_name ?? ''} ${formatCents(amount ?? 0)}`);
    } else {
      toast('已保存');
      go(eventId ? { name: 'event', id: eventId } : { name: 'home' });
    }
  }

  /* 本次会话合计 */
  const sessionTotal = session.reduce((a, r) => a + r.amount, 0);

  /**
   * boot() 之后 ledger 一定存在（空账本也会兜底），
   * 所以这里只是类型收窄，正常情况走不到。
   * 万一真为空也不能 return null —— 那会让用户看到一片空白，
   * 而是给一句能看懂的提示 + 回首页的出口。
   */
  if (!ledger) {
    return (
      <div className="card">
        <EmptyState
          icon="⏳"
          title="账本还没准备好"
          action={
            <button className="btn primary" onClick={() => go({ name: 'home' })}>
              回到首页
            </button>
          }
        >
          本机账本正在加载，或者读取时出了点问题。回首页重试一下，或者到设置里从备份恢复。
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <div className="page-head row-between">
        <div>
          <h1>记一笔</h1>
          <p>
            {session.length > 0
              ? `本次已录 ${session.length} 笔，合计 ${formatCents(sessionTotal)}`
              : quickAddHint()}
          </p>
        </div>
        <button className="btn ghost" onClick={() => go({ name: 'home' })}>
          返回首页
        </button>
      </div>

      <div className="grid grid-2">
        <div>
          {/* ---------------- 场次 ---------------- */}
          <div className="card">
            <h3>1. 记在哪一场</h3>

            {events.length === 0 && !showNewEvent ? (
              <div className="notice info" style={{ marginTop: 0 }}>
                还没有场次。先建一个，或者直接建一个「临时一场」。
              </div>
            ) : null}

            <Field label="场次">
              <select
                className="select"
                value={eventId ?? ''}
                onChange={(e) => setEventId(e.target.value || null)}
              >
                <option value="">— 请选择场次 —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.date} {ev.title}（{ev.type}
                    {ev.host_side === 'self' ? ' · 我家办事' : ''}）
                  </option>
                ))}
              </select>
            </Field>

            {selectedEvent ? (
              <div className="hint">
                {selectedEvent.host_side === 'self'
                  ? '这是我家办的场次，默认记「收来」。'
                  : '这是对方家办的场次，默认记「随出」。'}
                {selectedEvent.host_side === 'other' && selectedEvent.host_contact_id
                  ? ' 对方已锁定为该场东道主。'
                  : ''}
              </div>
            ) : null}

            {showNewEvent ? (
              <NewEventInline
                defaultDate={happenedOn}
                onCancel={() => setShowNewEvent(false)}
                onCreate={(title, type, hostSide, hostContactId) => {
                  const ev = addEvent({
                    title,
                    type,
                    date: happenedOn,
                    host_side: hostSide,
                    host_contact_id: hostContactId ?? null,
                  });
                  setEventId(ev.id);
                  setShowNewEvent(false);
                  toast('场次已建好');
                }}
                contacts={contacts}
                onCreateContact={(name) => addContact({ display_name: name })}
              />
            ) : (
              <button className="btn sm" onClick={() => setShowNewEvent(true)}>
                ＋ 新建场次
              </button>
            )}
          </div>

          {/* ---------------- 对方 ---------------- */}
          <div className="card">
            <h3>2. 对方是谁</h3>
            <ContactPicker
              contacts={contacts}
              value={contactId}
              onChange={setContactId}
              onCreate={(name, relation) =>
                addContact({ display_name: name, relation: relation ?? '其他' })
              }
            />
            <div className="hint">
              打名字就能找，找不到会提示「新建户头」。别名（比如「三舅」）也能搜到。
            </div>
          </div>
        </div>

        <div>
          {/* ---------------- 金额与方向 ---------------- */}
          <div className="card">
            <h3>3. 多少、哪边</h3>

            <Field label="方向">
              <Segmented<Direction>
                className="direction"
                value={direction}
                onChange={setDirection}
                options={[
                  { value: 'give', label: '随出（我给对方）', dir: 'give' },
                  { value: 'receive', label: '收来（对方给我）', dir: 'receive' },
                ]}
              />
            </Field>

            <Field label="金额">
              <MoneyInput
                key={amountKey.current}
                valueCents={amount}
                onChange={setAmount}
                onEnter={() => save(true)}
                autoFocus
              />
            </Field>

            <div className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
              {quickAddSubHint()}
            </div>

            <div className="btn-row">
              <button
                className="btn primary lg"
                onClick={() => save(true)}
                disabled={!canSave()}
              >
                保存并继续
              </button>
              <button className="btn lg" onClick={() => save(false)} disabled={!canSave()}>
                保存并查看
              </button>
            </div>
          </div>

          {/* ---------------- 高级选项 ---------------- */}
          <div className="card">
            <div className="row-between">
              <h3 style={{ margin: 0 }}>补充信息</h3>
              <button className="btn ghost sm" onClick={() => setShowMore((v) => !v)}>
                {showMore ? '收起' : '展开'}
              </button>
            </div>

            {showMore ? (
              <div style={{ marginTop: 14 }}>
                <div className="field-row">
                  <Field label="日期">
                    <input
                      className="input"
                      type="date"
                      value={happenedOn}
                      onChange={(e) => setHappenedOn(e.target.value)}
                    />
                  </Field>
                  <Field label="随礼方式">
                    <select
                      className="select"
                      value={method}
                      onChange={(e) => setMethod(e.target.value as Method)}
                    >
                      {METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="形态">
                  <Segmented<GiftKind>
                    value={giftKind}
                    onChange={setGiftKind}
                    options={[
                      { value: 'cash', label: '只有礼金' },
                      { value: 'goods', label: '只有礼物' },
                      { value: 'both', label: '礼金 + 礼物' },
                    ]}
                  />
                </Field>

                {giftKind !== 'cash' ? (
                  <div className="field-row">
                    <Field label="礼物是什么">
                      <input
                        className="input"
                        type="text"
                        value={goodsDesc}
                        placeholder="例：茅台一瓶"
                        onChange={(e) => setGoodsDesc(e.target.value)}
                      />
                    </Field>
                    <Field
                      label="礼物估价"
                      hint="礼物估价不计入还礼现金建议，只在依据里提一句。"
                    >
                      <MoneyInput
                        valueCents={goodsValue}
                        onChange={setGoodsValue}
                        quickAmounts={[100, 200, 300, 500, 1000]}
                      />
                    </Field>
                  </div>
                ) : null}

                <Field label="经手人" hint="家里谁去的、谁收的">
                  <input
                    className="input"
                    type="text"
                    value={handler}
                    placeholder="例：我和爸妈 / 托同学带"
                    onChange={(e) => setHandler(e.target.value)}
                  />
                </Field>

                <Field label="备注">
                  <textarea
                    className="textarea"
                    value={notes}
                    placeholder="例：包了红包没吃饭 / 只随礼未到场"
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 8 }}>
                日期、方式、礼物、经手人、备注都在这里。不填也能存。
              </div>
            )}
          </div>

          {/* ---------------- 本次已录 ---------------- */}
          {session.length > 0 ? (
            <div className="card tight">
              <div style={{ padding: '15px 17px 11px' }} className="row-between">
                <h3 style={{ margin: 0 }}>本次已录 {session.length} 笔</h3>
                <strong className="mono-num">{formatCents(sessionTotal)}</strong>
              </div>
              <div className="list" style={{ maxHeight: 240, overflowY: 'auto' }}>
                {session
                  .slice()
                  .reverse()
                  .map((r) => (
                    <div key={r.key} className="list-item">
                      <div className="mid">
                        <div className="title" style={{ fontSize: '0.95em' }}>
                          {r.contactName}
                          <span className={`tag ${r.direction}`}>
                            {r.direction === 'give' ? '随出' : '收来'}
                          </span>
                        </div>
                      </div>
                      <div className="right">
                        <div
                          className={`big ${r.direction === 'give' ? 'amt-give' : 'amt-receive'}`}
                        >
                          {formatCents(r.amount, { symbol: false })}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 内联新建场次 */

function NewEventInline({
  defaultDate,
  contacts,
  onCreate,
  onCreateContact,
  onCancel,
}: {
  defaultDate: string;
  contacts: { id: string; display_name: string; relation: string; aliases: string[] }[];
  onCreate: (
    title: string,
    type: EventType,
    hostSide: 'self' | 'other',
    hostContactId?: string | null,
  ) => void;
  onCreateContact: (name: string) => { id: string };
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('结婚');
  const [hostSide, setHostSide] = useState<'self' | 'other'>('other');
  const [hostId, setHostId] = useState<string | null>(null);

  const fullTitle =
    title.trim() ||
    (hostSide === 'other'
      ? `${contacts.find((c) => c.id === hostId)?.display_name ?? ''}${type}`
      : `我家${type}`);

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius)',
        background: 'var(--paper-2)',
      }}
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

      <Field label="谁办事">
        <Segmented<'self' | 'other'>
          value={hostSide}
          onChange={setHostSide}
          options={[
            { value: 'other', label: '对方家办事' },
            { value: 'self', label: '我家办事' },
          ]}
        />
      </Field>

      {hostSide === 'other' ? (
        <Field label="对方">
          <ContactPicker
            contacts={contacts as never}
            value={hostId}
            onChange={setHostId}
            onCreate={(name: string, relation?: Relation) => {
              const c = onCreateContact(name);
              void relation;
              return c as never;
            }}
          />
        </Field>
      ) : null}

      <Field label="名称" hint={`留空就用「${fullTitle}」`}>
        <input
          className="input"
          type="text"
          value={title}
          placeholder={fullTitle}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <div className="btn-row">
        <button
          className="btn primary"
          onClick={() => onCreate(fullTitle, type, hostSide, hostId)}
          disabled={hostSide === 'other' && !hostId && !title.trim()}
        >
          建好并用它
        </button>
        <button className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
      <div className="hint">日期沿用上面选的 {defaultDate}，建好后可以在场次页改。</div>
    </div>
  );
}

/** 供外部使用：把「800元」这类输入解析成金额，导出给测试用 */
export { parseMoneyToCents };
