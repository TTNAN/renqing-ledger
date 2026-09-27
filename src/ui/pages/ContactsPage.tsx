/**
 * 人情账 · 户头（列表 + 详情）
 *
 * 户头是「一户人家」，不是通讯录条目。
 * 所以详情页的重心是「跟他家的全部往来」，而不是电话地址。
 */

import { useMemo, useState } from 'react';
import { formatCN, todayISO } from '@/domain/date';
import { formatCents } from '@/domain/money';
import { suggestGiftAmount } from '@/domain/suggest';
import { summarizeContacts, totalsOf } from '@/domain/stats';
import { EVENT_TYPES, RELATIONS } from '@/domain/types';
import type { Contact, EventType, Relation } from '@/domain/types';
import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';
import {
  Avatar,
  ConfirmModal,
  EmptyState,
  Field,
  Modal,
} from '@/ui/components/common';
import { RelationPicker } from '@/ui/components/ContactPicker';
import { SuggestCard } from '@/ui/components/SuggestCard';
import { LedgerNotReady } from '@/ui/components/LedgerNotReady';

/* ================================================================== 列表 */

export function ContactsPage({ go }: { go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const summaries = useMemo(() => {
    if (!ledger) return [];
    const list = summarizeContacts(ledger.entries, ledger.contacts).filter((s) =>
      showArchived ? true : !s.contact.archived,
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const c = s.contact;
      const hay = [
        c.display_name,
        c.legal_name ?? '',
        ...(c.aliases ?? []),
        c.clan_or_branch ?? '',
        c.relation,
        c.notes ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [ledger, query, showArchived]);

  const grand = useMemo(() => {
    const rows = (ledger?.entries ?? [])
      .filter((e) => !e.deleted_at)
      .map((entry) => ({ entry, event: null, contact: null }));
    return totalsOf(rows);
  }, [ledger]);

  if (!ledger) return <LedgerNotReady go={go} />;

  return (
    <>
      <div className="page-head">
        <h1>对方户头</h1>
        <p>
          按「一户人家」来记，不是通讯录。共 {summaries.length} 户 · 累计随出{' '}
          {formatCents(grand.give)} · 累计收来 {formatCents(grand.receive)}
        </p>
      </div>

      <div className="card">
        <div className="row-between">
          <div className="search-bar" style={{ flex: 1, marginBottom: 0, minWidth: 220 }}>
            <span className="icon">🔍</span>
            <input
              className="input"
              type="text"
              value={query}
              placeholder="搜称呼、姓名、别名、分支"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            显示已归档
          </label>
        </div>
      </div>

      {summaries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="👥"
            title={query ? `没找到「${query}」` : '还没有户头'}
            action={
              query ? null : (
                <button className="btn primary" onClick={() => go({ name: 'quick-add' })}>
                  去记一笔，顺便建户头
                </button>
              )
            }
          >
            {query
              ? '换个说法试试，别名也能搜到。'
              : '记第一笔账的时候，输入对方称呼就会自动建户头。'}
          </EmptyState>
        </div>
      ) : (
        <div className="card tight">
          <div className="list">
            {summaries.map((s) => (
              <button
                key={s.contact.id}
                className="list-item"
                onClick={() => go({ name: 'contact', id: s.contact.id })}
              >
                <Avatar name={s.contact.display_name} />
                <div className="mid">
                  <div className="title">
                    {s.contact.display_name}
                    <span className="tag">{s.contact.relation}</span>
                    {s.contact.archived ? <span className="tag archived">已归档</span> : null}
                  </div>
                  <div className="meta">
                    {(s.contact.aliases ?? []).length > 0
                      ? `别名 ${(s.contact.aliases ?? []).join('、')}`
                      : s.contact.clan_or_branch || '—'}
                    {s.count > 0 ? ` · ${s.count} 笔往来` : ' · 暂无往来'}
                    {s.lastDate ? ` · 最近 ${formatCN(s.lastDate)}` : ''}
                  </div>
                </div>
                <div className="right">
                  <div className={`big ${s.net >= 0 ? 'amt-receive' : 'amt-give'}`}>
                    {formatCents(Math.abs(s.net), { symbol: false })}
                  </div>
                  <div className="sub">
                    随出 {formatCents(s.give, { symbol: false })} / 收来{' '}
                    {formatCents(s.receive, { symbol: false })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================== 详情 */

export function ContactDetailPage({ id, go }: { id: string; go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const updateContact = useStore((s) => s.updateContact);
  const deleteContact = useStore((s) => s.deleteContact);
  const archiveContact = useStore((s) => s.archiveContact);
  const mergeContacts = useStore((s) => s.mergeContacts);
  const toast = useStore((s) => s.toast);

  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [simType, setSimType] = useState<EventType>('结婚');

  const contact = ledger?.contacts.find((c) => c.id === id && !c.deleted_at) ?? null;

  const history = useMemo(() => {
    if (!ledger || !contact) return [];
    return ledger.entries
      .filter((e) => !e.deleted_at && e.contact_id === contact.id)
      .map((e) => ({
        entry: e,
        event: ledger.events.find((ev) => ev.id === e.event_id) ?? null,
      }))
      .sort((a, b) => String(b.entry.happened_on).localeCompare(String(a.entry.happened_on)));
  }, [ledger, contact]);

  const totals = useMemo(() => {
    let give = 0;
    let receive = 0;
    for (const h of history) {
      if (h.entry.direction === 'give') give += h.entry.amount_cents;
      else receive += h.entry.amount_cents;
    }
    return { give, receive, net: receive - give };
  }, [history]);

  const suggestion = useMemo(() => {
    if (!ledger || !contact) return null;
    return suggestGiftAmount({
      entries: ledger.entries.filter((e) => e.contact_id === contact.id),
      targetType: simType,
      eventTypeOf: (eventId) => ledger.events.find((ev) => ev.id === eventId)?.type,
      direction: 'give',
      settings: ledger.settings,
      now: todayISO(),
    });
  }, [ledger, contact, simType]);

  if (!ledger) return <LedgerNotReady go={go} />;

  if (!contact) {
    return (
      <div className="card">
        <EmptyState
          icon="🤷"
          title="这个户头不存在"
          action={
            <button className="btn" onClick={() => go({ name: 'contacts' })}>
              返回户头列表
            </button>
          }
        />
      </div>
    );
  }

  const mergeCandidates = ledger.contacts.filter(
    (c) => !c.deleted_at && c.id !== contact.id,
  );

  return (
    <>
      <div className="page-head">
        <button className="btn ghost sm" onClick={() => go({ name: 'contacts' })}>
          ← 户头列表
        </button>
      </div>

      <div className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <Avatar name={contact.display_name} size={52} />
            <div>
              <h1 style={{ margin: '0 0 3px', fontSize: '1.35em' }}>
                {contact.display_name}
              </h1>
              <div className="small muted">
                {contact.relation}
                {contact.clan_or_branch ? ` · ${contact.clan_or_branch}` : ''}
                {contact.legal_name ? ` · 姓名 ${contact.legal_name}` : ''}
                {contact.archived ? ' · 已归档' : ''}
              </div>
              {(contact.aliases ?? []).length > 0 ? (
                <div className="small muted" style={{ marginTop: 3 }}>
                  别名：{(contact.aliases ?? []).join('、')}
                </div>
              ) : null}
              {contact.phone ? (
                <div className="small muted" style={{ marginTop: 3 }}>
                  电话：{contact.phone}
                </div>
              ) : null}
            </div>
          </div>

          <div className="btn-row">
            <button className="btn sm" onClick={() => setEditing(true)}>
              编辑
            </button>
            <button className="btn sm" onClick={() => setMerging(true)}>
              合并户头
            </button>
            <button
              className="btn sm"
              onClick={() => {
                archiveContact(contact.id, !contact.archived);
                toast(contact.archived ? '已取消归档' : '已归档，统计仍会算入');
              }}
            >
              {contact.archived ? '取消归档' : '归档'}
            </button>
            <button className="btn sm danger" onClick={() => setConfirmDelete(true)}>
              删除
            </button>
          </div>
        </div>

        {contact.notes ? (
          <div className="notice info" style={{ marginTop: 13 }}>
            {contact.notes}
          </div>
        ) : null}

        <div className="grid grid-3" style={{ marginTop: 15 }}>
          <div className="stat give" style={{ boxShadow: 'none' }}>
            <div className="k">累计你随出</div>
            <div className="v">{formatCents(totals.give)}</div>
          </div>
          <div className="stat receive" style={{ boxShadow: 'none' }}>
            <div className="k">累计对方随来</div>
            <div className="v">{formatCents(totals.receive)}</div>
          </div>
          <div className="stat" style={{ boxShadow: 'none' }}>
            <div className="k">差额</div>
            <div className="v">{formatCents(Math.abs(totals.net))}</div>
          </div>
        </div>

        <div className="notice info">
          {totals.net === 0
            ? `累计你随出 ${formatCents(totals.give)}，对方随来 ${formatCents(totals.receive)}，两边持平。`
            : totals.net > 0
              ? `累计你随出 ${formatCents(totals.give)}，对方随来 ${formatCents(totals.receive)}。目前对方多出 ${formatCents(totals.net)}，下次对方办事可参考这个差额。`
              : `累计你随出 ${formatCents(totals.give)}，对方随来 ${formatCents(totals.receive)}。目前你多出 ${formatCents(-totals.net)}。`}
        </div>
      </div>

      {/* ---------------- 模拟还礼 ---------------- */}
      <div className="card">
        <h3>如果对方现在办事</h3>
        <Field label="办什么">
          <div className="chips">
            {EVENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip${simType === t ? ' on' : ''}`}
                onClick={() => setSimType(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>
        {suggestion ? (
          <SuggestCard suggestion={suggestion} targetType={simType} direction="give" />
        ) : null}
      </div>

      {/* ---------------- 时间线 ---------------- */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>往来记录（{history.length} 笔）</h3>
          <button className="btn sm" onClick={() => go({ name: 'quick-add' })}>
            ＋ 记一笔
          </button>
        </div>

        {history.length === 0 ? (
          <div className="hint">还没有往来记录。</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>场次</th>
                  <th>方向</th>
                  <th>方式</th>
                  <th>经手人</th>
                  <th>备注</th>
                  <th style={{ textAlign: 'right' }}>金额</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ entry, event }) => (
                  <tr key={entry.id}>
                    <td className="nowrap">{formatCN(entry.happened_on)}</td>
                    <td>
                      {event ? (
                        <button
                          className="btn ghost sm"
                          style={{ padding: '2px 6px' }}
                          onClick={() => go({ name: 'event', id: event.id })}
                        >
                          {event.title}
                        </button>
                      ) : (
                        <span className="muted">（已删）</span>
                      )}
                      {event ? (
                        <span className={`tag${event.type === '白事' ? ' sombre' : ''}`} style={{ marginLeft: 5 }}>
                          {event.type}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className={`tag ${entry.direction}`}>
                        {entry.direction === 'give' ? '随出' : '收来'}
                      </span>
                    </td>
                    <td className="small">{entry.method ?? '—'}</td>
                    <td className="small">{entry.handler ?? '—'}</td>
                    <td className="small muted">
                      {[entry.goods_desc, entry.notes].filter(Boolean).join('；') || '—'}
                    </td>
                    <td
                      className={`num ${entry.direction === 'give' ? 'amt-give' : 'amt-receive'}`}
                    >
                      {formatCents(entry.amount_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>合计</td>
                  <td className="num">
                    <span className="amt-give">随出 {formatCents(totals.give)}</span>
                    {' / '}
                    <span className="amt-receive">收来 {formatCents(totals.receive)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- 弹窗 ---------------- */}
      {editing ? (
        <EditContactModal
          contact={contact}
          onClose={() => setEditing(false)}
          onSave={(patch) => {
            updateContact(contact.id, patch);
            setEditing(false);
            toast('已保存');
          }}
        />
      ) : null}

      {merging ? (
        <MergeModal
          source={contact}
          candidates={mergeCandidates}
          onClose={() => setMerging(false)}
          onMerge={(intoId) => {
            mergeContacts(contact.id, intoId);
            setMerging(false);
            toast('已合并，历史记录都归到目标户头');
            go({ name: 'contact', id: intoId });
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmModal
          title="删除户头"
          danger
          confirmText="删除"
          message={
            <>
              确定删除「<strong>{contact.display_name}</strong>」吗？
              <div className="hint" style={{ marginTop: 8 }}>
                这是软删除：{history.length} 笔往来记录会保留在账本里，
                但不再出现在统计和列表里。之后可以恢复。
              </div>
            </>
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            deleteContact(contact.id);
            setConfirmDelete(false);
            toast('已删除');
            go({ name: 'contacts' });
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ 编辑弹窗 */

function EditContactModal({
  contact,
  onClose,
  onSave,
}: {
  contact: Contact;
  onClose: () => void;
  onSave: (patch: Partial<Contact>) => void;
}) {
  const [displayName, setDisplayName] = useState(contact.display_name);
  const [legalName, setLegalName] = useState(contact.legal_name ?? '');
  const [aliases, setAliases] = useState((contact.aliases ?? []).join('、'));
  const [relation, setRelation] = useState<Relation>(contact.relation);
  const [branch, setBranch] = useState(contact.clan_or_branch ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [notes, setNotes] = useState(contact.notes ?? '');

  function save() {
    const aliasList = aliases
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({
      display_name: displayName.trim() || contact.display_name,
      legal_name: legalName.trim() || undefined,
      aliases: aliasList,
      relation,
      clan_or_branch: branch.trim() || undefined,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Modal
      title="编辑户头"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <Field label="称呼" hint="平时怎么叫他，比如「张叔」「李家」">
        <input
          className="input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>

      <Field label="姓名" hint="可选，用于对不上号时查">
        <input
          className="input"
          type="text"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
        />
      </Field>

      <Field
        label="别名"
        hint="用「、」或逗号分隔。比如「三舅、母舅王家」。搜索时别名也能命中。"
      >
        <input
          className="input"
          type="text"
          value={aliases}
          placeholder="三舅、母舅王家"
          onChange={(e) => setAliases(e.target.value)}
        />
      </Field>

      <Field label="关系">
        <RelationPicker value={relation} onChange={setRelation} />
      </Field>

      <div className="field-row">
        <Field label="所属家庭 / 分支" hint="例：妈妈这边、同事组">
          <input
            className="input"
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        </Field>
        <Field label="电话">
          <input
            className="input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>

      <Field label="备注">
        <textarea
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="hint">
        关系可选：{RELATIONS.join(' / ')}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 合并弹窗 */

function MergeModal({
  source,
  candidates,
  onClose,
  onMerge,
}: {
  source: Contact;
  candidates: Contact[];
  onClose: () => void;
  onMerge: (intoId: string) => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);

  const list = candidates.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.display_name, c.legal_name ?? '', ...(c.aliases ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const target = candidates.find((c) => c.id === targetId) ?? null;

  if (confirming && target) {
    return (
      <ConfirmModal
        title="确认合并"
        confirmText="合并"
        message={
          <>
            把「<strong>{source.display_name}</strong>」合并进「
            <strong>{target.display_name}</strong>」？
            <div className="hint" style={{ marginTop: 8 }}>
              所有往来记录会归到「{target.display_name}」名下，
              「{source.display_name}」会变成它的一个别名，历史查询不会断。
              原户头会被标记删除，数据本身不丢。
            </div>
          </>
        }
        onCancel={() => setConfirming(false)}
        onConfirm={() => onMerge(target.id)}
      />
    );
  }

  return (
    <Modal
      title={`把「${source.display_name}」合并到哪一户`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!target}
            onClick={() => setConfirming(true)}
          >
            下一步
          </button>
        </>
      }
    >
      <div className="notice info" style={{ marginTop: 0 }}>
        发现重复户头时用这个。合并后两边记录归到一户，方便看总账。
      </div>

      <div className="search-bar">
        <span className="icon">🔍</span>
        <input
          className="input"
          type="text"
          value={query}
          placeholder="搜目标户头"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {list.map((c) => (
          <button
            key={c.id}
            className="list-item"
            style={
              c.id === targetId
                ? { background: 'var(--paper)', boxShadow: 'inset 3px 0 0 var(--ink)' }
                : undefined
            }
            onClick={() => setTargetId(c.id)}
          >
            <Avatar name={c.display_name} size={32} />
            <div className="mid">
              <div className="title" style={{ fontSize: '0.95em' }}>
                {c.display_name}
                <span className="tag">{c.relation}</span>
              </div>
              <div className="meta">
                {(c.aliases ?? []).length > 0 ? (c.aliases ?? []).join('、') : '—'}
              </div>
            </div>
          </button>
        ))}
        {list.length === 0 ? (
          <div className="empty" style={{ padding: '24px 16px' }}>
            <div className="small">没有可合并的户头</div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
