import './style.css';

import {
  bestCashPrices,
  dealSummary,
  entryStatus,
  isUsable,
  itemMap,
  normalizeGroup,
  planOrder,
  rankRedemptions,
  todayIn,
  validateData,
} from './calc';
import type { ItemMap, Plan, Status, Step } from './calc';
import type { Balances, Cart, Dated, Deal, Group, Line, OfferData, Ymd } from './types';

const DRAFT_KEY = 'mcd-calc:draft';
const CART_KEY = 'mcd-calc:cart';
const BAL_KEY = 'mcd-calc:balances';
// 相對路徑：部署在子路徑底下也讀得到
const DATA_URL = `${import.meta.env.BASE_URL}data/offers.json`;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`找不到 #${id}`);
  return el as T;
}
const input = (id: string) => $<HTMLInputElement>(id);

function loadJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

interface RankFilter {
  query: string;
  currency: string;
  kind: 'all' | 'points' | 'mixed';
  sort: 'rate' | 'points';
  affordable: boolean;
}

const state: {
  repoData: OfferData | null;
  data: OfferData | null;
  cart: Cart;
  balances: Balances;
  pickerCat: string;
  pickerQuery: string;
  rank: RankFilter;
} = {
  repoData: null,
  data: null,
  cart: loadJson<Cart>(CART_KEY, {}),
  balances: loadJson<Balances>(BAL_KEY, {}),
  pickerCat: 'all',
  pickerQuery: '',
  rank: { query: '', currency: 'all', kind: 'all', sort: 'rate', affordable: false },
};

// 搜尋時「鷄／雞」、全半形空白、大小寫都視為一樣
const normalize = (s: string) => s.toLowerCase().replace(/鷄/g, '雞').replace(/\s+/g, '');

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `$${Number(n.toFixed(1))}`;
const perPoint = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toFixed(n !== 0 && Math.abs(n) < 1 ? 3 : 2);
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`;
const mmdd = (ymd: Ymd) => ymd.slice(5).replace('-', '/');
function range<T>(a: T, b: T, fmt: (x: T) => string = String): string {
  return a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`;
}

function statusChip(entry: Dated, today: Ymd): string {
  const s: Status = entryStatus(entry, today);
  switch (s.state) {
    case 'always':
      return '<span class="chip">常駐</span>';
    case 'active':
      if (s.daysLeft === null || !entry.end) return '<span class="chip">期間限定</span>';
      return `<span class="chip ${s.expiring ? 'chip-warn' : ''}">期間限定 · 到 ${mmdd(entry.end)}（剩 ${s.daysLeft} 天）</span>`;
    case 'upcoming':
      return `<span class="chip chip-muted">${s.daysUntil} 天後開始（${mmdd(entry.start ?? '')}）</span>`;
    case 'expired':
      return `<span class="chip chip-muted">已結束${entry.end ? `（${mmdd(entry.end)}）` : ''}</span>`;
    default:
      return '<span class="chip chip-muted">停用</span>';
  }
}

const unverified = (entry: Dated) =>
  entry.verified ? '' : '<span class="chip chip-check" title="尚未在 APP 或門市確認">待確認</span>';

// 資料本身的日期，不是抓取日；沒有日期要明講
const asOfText = (entry: Dated) => (entry.asOf ? `資料日期 ${entry.asOf}` : '資料日期不明');

function lineNames(items: ItemMap, lines: Line[]): string {
  return lines
    .map(({ id, qty = 1 }) => {
      const name = items.get(id)?.name ?? id;
      return qty > 1 ? `${name} ×${qty}` : name;
    })
    .join('、');
}

function groupText(items: ItemMap, group: Group): string {
  const { ids, qty } = normalizeGroup(group);
  const names = ids.map((id) => items.get(id)?.name ?? id);
  const shown =
    names.length > 3 ? `${names.slice(0, 3).join('／')} 等 ${names.length} 選 1` : names.join('／');
  return qty > 1 ? `${shown} ×${qty}` : shown;
}

interface Settings {
  today: Ymd;
  showInactive: boolean;
}

function settings(): Settings {
  return {
    today: input('ctl-date').value || todayIn(),
    showInactive: input('ctl-inactive').checked,
  };
}

// 分段按鈕（取代原生下拉）：同一組裡只有一個 aria-checked=true
function setSeg(el: HTMLElement, value: string) {
  for (const b of el.querySelectorAll<HTMLButtonElement>('button[role="radio"]')) {
    b.setAttribute('aria-checked', String(b.dataset.value === value));
    b.tabIndex = b.dataset.value === value ? 0 : -1;
  }
}

function onSeg(el: HTMLElement, handler: (value: string) => void) {
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[role="radio"]');
    if (!b?.dataset.value) return;
    setSeg(el, b.dataset.value);
    handler(b.dataset.value);
  });
  // 方向鍵在同一組裡移動，符合 radiogroup 的鍵盤操作
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
    const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next.focus();
    next.click();
    e.preventDefault();
  });
}

function renderPromos(data: OfferData, { today }: Settings) {
  const active = (data.promos ?? []).filter((p) => isUsable(p, today));
  $('promos').innerHTML = active
    .map(
      (p) => `
      <p class="promo">
        <b>${esc(p.name)}</b> ${statusChip(p, today)}${unverified(p)}
        <span>${esc(p.note ?? '')}</span>
      </p>`,
    )
    .join('');
}

function renderRank(data: OfferData, { today }: Settings) {
  const items = itemMap(data);
  const deals = new Map(data.deals.map((d) => [d.id, d]));
  const f = state.rank;
  const q = normalize(f.query);
  const all = rankRedemptions(data, today);
  const rows = all.filter((r) => {
    const red = r.redemption;
    if (f.currency !== 'all' && red.currency !== f.currency) return false;
    if (f.kind === 'points' && red.cash) return false;
    if (f.kind === 'mixed' && !red.cash) return false;
    if (f.affordable && r.points > (state.balances[red.currency] ?? 0)) return false;
    if (q) {
      const text = normalize(`${lineNames(items, red.items)}${red.label ?? ''}`);
      if (!text.includes(q)) return false;
    }
    return true;
  });
  if (f.sort === 'points') {
    rows.sort((a, b) => Number(b.usable) - Number(a.usable) || a.points - b.points);
  }
  $('rank-count').textContent =
    rows.length === all.length ? `共 ${all.length} 筆` : `符合 ${rows.length} / ${all.length} 筆`;
  const maxRate = Math.max(
    0,
    ...rows.filter((r) => r.usable && r.rebateRate !== null).map((r) => r.rebateRate as number),
  );

  if (!rows.length) {
    const hint = f.affordable ? '（「只看我換得起的」是用上面填的點數餘額來篩）' : '';
    $('rank').innerHTML = `<li class="empty">沒有符合的兌換項目${hint}。</li>`;
    return;
  }

  $('rank').innerHTML = rows
    .map((row) => {
      const r = row.redemption;
      const cash = r.cash ? ` + ${money(r.cash)}` : '';
      const pts =
        row.multiplier < 1
          ? `<s>${r.points.toLocaleString('zh-TW')}</s> ${Math.round(row.points).toLocaleString('zh-TW')} 點`
          : `${r.points.toLocaleString('zh-TW')} 點`;
      const promoChip = row.promo
        ? `<span class="chip chip-warn">${esc(row.promo.name)} · ${Math.round(row.multiplier * 100) / 10} 折</span>`
        : '';
      const partner = row.partners.length
        ? `・配${row.partners.map((id) => items.get(id)?.name ?? id).join('、')}`
        : '';
      const upsize = row.upsize ? `，改買${items.get(row.upsize)?.name ?? row.upsize}` : '';
      const via = row.viaDeals.map((id) => deals.get(id)?.name ?? id).join('、') + partner + upsize;
      const losing = row.perPointAlt !== null && row.perPointAlt <= 0;
      const altNote =
        row.altTotal !== null && row.listTotal !== null && row.altTotal < row.listTotal - 1e-9
          ? `；最便宜現金價 ${money(row.altTotal)}（${esc(via)}）`
          : '';
      const width =
        row.usable && maxRate > 0 && row.rebateRate !== null
          ? Math.max(0, (row.rebateRate / maxRate) * 100)
          : 0;
      return `
        <li class="row ${row.usable ? '' : 'is-dim'}">
          <div class="what">
            <span class="name">${esc(lineNames(items, r.items))}${r.label ? `<small>${esc(r.label)}</small>` : ''}</span>
            <span class="meta">
              <span class="cur">${esc(row.currency?.name ?? r.currency)}</span>
              <span class="pts">${pts}${cash}</span>
              ${promoChip}${statusChip(r, today)}${unverified(r)}
            </span>
            <span class="detail">牌價 ${money(row.listTotal)}，每點 ${perPoint(row.perPointList)} 元${altNote}</span>
            <span class="detail">點數：${esc(asOfText(r))}</span>
          </div>
          <div class="figure">
            <span class="big">${losing ? '不划算' : pct(row.rebateRate)}</span>
            <span class="small">${losing ? '加付的現金已經比最便宜買法還貴' : `每點實值 ${perPoint(row.perPointAlt)} 元`}</span>
          </div>
          <div class="bar" aria-hidden="true"><span style="--w:${width.toFixed(1)}%"></span></div>
        </li>`;
    })
    .join('');
}

function dealBody(data: OfferData, items: ItemMap, d: Deal): string {
  const s = dealSummary(data, d);
  const dollars = (x: number) => `$${Number(x.toFixed(1))}`;
  if (d.type === 'bogo') {
    return `
      <p class="deal-items"><b>買 A</b>${esc(lineNames(items, d.buy.map((id) => ({ id }))))}</p>
      <p class="deal-items"><b>送 B</b>${esc(lineNames(items, d.get.map((id) => ({ id }))))}</p>
      <dl class="figures">
        <div><dt>卡費</dt><dd>${d.fee ? money(d.fee) : '—'}</dd></div>
        <div><dt>每次省</dt><dd>${s ? range(s.minSave, s.maxSave, dollars) : '—'}</dd></div>
        <div><dt>幾次回本</dt><dd>${s?.usesBest ? `${range(s.usesBest, s.usesWorst)} 次` : '—'}</dd></div>
      </dl>`;
  }
  const lines =
    d.type === 'bundle'
      ? esc(lineNames(items, d.items))
      : d.groups.map((grp) => esc(groupText(items, grp))).join(' ＋ ');
  const priceLabel = Number.isFinite(d.price) ? '組合價' : '實付';
  return `
    <p class="deal-items">${lines}</p>
    <dl class="figures">
      <div><dt>${priceLabel}</dt><dd>${s ? range(s.paidMin, s.paidMax, dollars) : '—'}</dd></div>
      <div><dt>省下</dt><dd>${s ? range(s.minSave, s.maxSave, dollars) : '—'}</dd></div>
      <div><dt>折扣</dt><dd>${s ? range(s.minRate, s.maxRate, pct) : '—'}</dd></div>
    </dl>`;
}

const STATE_ORDER: Record<Status['state'], number> = {
  active: 0,
  always: 1,
  upcoming: 2,
  expired: 3,
  disabled: 4,
};

function renderDeals(data: OfferData, { today, showInactive }: Settings) {
  const items = itemMap(data);
  const deals = data.deals
    .map((d) => ({ d, s: entryStatus(d, today) }))
    .filter(({ s }) => showInactive || s.state === 'active' || s.state === 'always')
    .sort(
      (a, b) =>
        STATE_ORDER[a.s.state] - STATE_ORDER[b.s.state] ||
        (a.d.end ?? '9999').localeCompare(b.d.end ?? '9999'),
    );

  $('deals').innerHTML = deals
    .map(
      ({ d, s }) => `
      <article class="deal ${s.state === 'active' || s.state === 'always' ? '' : 'is-dim'}">
        <h3>${esc(d.name)}</h3>
        <p class="meta">${statusChip(d, today)}${unverified(d)}</p>
        ${dealBody(data, items, d)}
        ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
        <p class="note">${esc(asOfText(d))} · ${esc(d.source ?? '')}</p>
      </article>`,
    )
    .join('');
}

function renderItems(data: OfferData, { today }: Settings) {
  const items = itemMap(data);
  const best = bestCashPrices(data, today);
  const deals = new Map(data.deals.map((d) => [d.id, d]));
  $('items').innerHTML = data.items
    .map((it) => {
      const b = best.get(it.id);
      const cheaper = b !== undefined && b.price < it.price - 1e-9;
      const partner = b?.partners.length
        ? `・配${b.partners.map((id) => items.get(id)?.name ?? id).join('、')}`
        : '';
      const viaName = b?.via ? (deals.get(b.via)?.name ?? b.via) : '';
      const upsize = b?.upsize ? `，改買${items.get(b.upsize)?.name ?? b.upsize}` : '';
      const via = cheaper ? `<small>${esc(viaName + partner + upsize)}</small>` : '';
      const portion = Number.isFinite(it.portion)
        ? `<small>份量 ${it.portion} ${esc(it.portionUnit ?? '')}</small>`
        : '';
      const ref = it.ref
        ? ` · <a href="${esc(it.ref)}" target="_blank" rel="noopener">官網商品頁</a>`
        : '';
      return `
        <tr>
          <th scope="row">${esc(it.name)}${portion}</th>
          <td class="num">${money(it.price)}</td>
          <td class="num ${cheaper ? 'is-cheaper' : ''}">${cheaper ? money(b.price) : '—'}${via}</td>
          <td class="src">
            ${esc(asOfText(it))} ${unverified(it)}
            ${it.conflict ? `<small class="conflict">價格不一致：${esc(it.conflict)}</small>` : ''}
            <small>${esc(it.source ?? '')}${ref}</small>
          </td>
        </tr>`;
    })
    .join('');
}

function renderStamp(data: OfferData) {
  const all: Dated[] = [
    ...data.currencies,
    ...data.items,
    ...data.deals,
    ...data.redemptions,
    ...(data.promos ?? []),
  ];
  const dates = all
    .map((e) => e.asOf)
    .filter((d): d is string => Boolean(d))
    .sort();
  const undated = all.length - dates.length;
  const pending = all.filter((e) => !e.verified).length;
  const span = dates.length ? range(dates[0], dates[dates.length - 1]) : '—';
  $('stamp').innerHTML = [
    `資料日期 ${esc(span)}`,
    undated ? `${undated} 筆來源沒寫日期` : '',
    `${pending} / ${all.length} 筆待確認`,
  ]
    .filter(Boolean)
    .join('<br>');
}

function renderCurrencyOptions(data: OfferData) {
  const el = $('rank-currency');
  const options = [{ id: 'all', name: '全部' }, ...data.currencies];
  if (!options.some((o) => o.id === state.rank.currency)) state.rank.currency = 'all';
  el.innerHTML = options
    .map(
      (o) =>
        `<button type="button" role="radio" data-value="${esc(o.id)}" aria-checked="false">${esc(o.name)}</button>`,
    )
    .join('');
  setSeg(el, state.rank.currency);
}

// ── 我想吃什麼 ──

function renderPicker(data: OfferData) {
  const cats = ['all', ...new Set(data.items.map((it) => it.category ?? '其他'))];
  if (!cats.includes(state.pickerCat)) state.pickerCat = 'all';
  $('pick-tabs').innerHTML = cats
    .map((cat) => {
      const on = cat === state.pickerCat;
      return `<button type="button" role="tab" data-cat="${esc(cat)}" aria-selected="${on}" tabindex="${on ? 0 : -1}">${cat === 'all' ? '全部' : esc(cat)}</button>`;
    })
    .join('');
  renderPickerGrid(data);
}

function renderPickerGrid(data: OfferData) {
  const q = normalize(state.pickerQuery);
  // 有搜尋字時跨類別找，不然只看目前分頁
  const list = data.items.filter((it) =>
    q
      ? normalize(it.name).includes(q)
      : state.pickerCat === 'all' || (it.category ?? '其他') === state.pickerCat,
  );
  $('pick-grid').innerHTML = list.length
    ? list
        .map((it) => {
          const n = state.cart[it.id] ?? 0;
          return `<button type="button" class="tile${n ? ' is-in' : ''}" data-add="${esc(it.id)}" aria-label="加一份 ${esc(it.name)}，目前 ${n} 份">
            <span class="tile-name">${esc(it.name)}</span>
            <span class="tile-price">${money(it.price)}</span>
            ${n ? `<span class="tile-count" aria-hidden="true">${n}</span>` : ''}
          </button>`;
        })
        .join('')
    : `<p class="empty">找不到「${esc(state.pickerQuery)}」。</p>`;
}

function renderCart(data: OfferData) {
  const items = itemMap(data);
  const entries = Object.entries(state.cart).filter(([id, q]) => q > 0 && items.has(id));
  $('cart').innerHTML = entries.length
    ? entries
        .map(([id, q]) => {
          const it = items.get(id);
          return `
        <li>
          <span class="cart-name">${esc(it?.name)}</span>
          <span class="cart-qty">
            <button type="button" class="quiet" data-cart="${esc(id)}" data-delta="-1" aria-label="少一份">－</button>
            <b>${q}</b>
            <button type="button" class="quiet" data-cart="${esc(id)}" data-delta="1" aria-label="多一份">＋</button>
          </span>
          <span class="cart-price">${money((it?.price ?? 0) * q)}</span>
        </li>`;
        })
        .join('')
    : '<li class="empty">還沒選。從上面挑想吃的東西加進來。</li>';
}

function stepRow(data: OfferData, items: ItemMap, step: Step): string {
  const what = esc(lineNames(items, step.lines));
  if (step.kind === 'single') {
    return `<li><span class="how">單點</span><span class="what">${what}</span><span class="pay">${money(step.paid)}</span></li>`;
  }
  if (step.kind === 'deal') {
    return `<li><span class="how">${esc(step.deal.name)}</span><span class="what">${what}<small>省 ${money(step.saved)}</small></span><span class="pay">${money(step.paid)}</span></li>`;
  }
  const cur = data.currencies.find((c) => c.id === step.currency);
  const promo = step.promo ? `（${esc(step.promo.name)}）` : '';
  return `<li class="is-redeem"><span class="how">用 ${step.points.toLocaleString('zh-TW')} 點 ${esc(cur?.name ?? '')}${promo}</span><span class="what">${what}</span><span class="pay">${money(step.paid)}</span></li>`;
}

function planCard(
  data: OfferData,
  items: ItemMap,
  title: string,
  plan: Plan,
  listTotal: number | null,
  extra = '',
): string {
  const saved = listTotal === null ? null : listTotal - plan.paid;
  return `
    <article class="plan">
      <h3>${title}</h3>
      <p class="plan-total"><b>${money(plan.paid)}</b><span>全部單點要 ${money(listTotal)}，省 ${money(saved)}</span></p>
      ${extra}
      <ol class="steps">${plan.steps.map((st) => stepRow(data, items, st)).join('')}</ol>
    </article>`;
}

function renderPlans(data: OfferData, { today }: Settings) {
  const items = itemMap(data);
  if (!Object.values(state.cart).some((q) => q > 0)) {
    $('plans').innerHTML = '';
    return;
  }
  const plan = planOrder(data, today, state.cart, state.balances);
  let html = planCard(data, items, '只付現金', plan.cashOnly, plan.listTotal);
  if (plan.withPoints) {
    const { pointsUsed, cashSaved } = plan.withPoints;
    const used = Object.entries(pointsUsed)
      .map(
        ([cur, pts]) =>
          `${pts.toLocaleString('zh-TW')} 點 ${esc(data.currencies.find((c) => c.id === cur)?.name ?? cur)}`,
      )
      .join('、');
    const curs = Object.keys(pointsUsed);
    // 兩種點數混用時平均每點沒有意義，只有一種才算
    const avg =
      curs.length === 1 ? `，平均每點折 ${perPoint(cashSaved / pointsUsed[curs[0]])} 元` : '';
    const extra = `<p class="note">用掉 ${used}，比只付現金再少付 ${money(cashSaved)}${avg}。點數也可以留著換更划算的東西，對照下方排行再決定。</p>`;
    html += planCard(data, items, '加上點數', plan.withPoints, plan.listTotal, extra);
  } else if (Object.values(state.balances).some((b) => b > 0)) {
    html += '<p class="note">手上的點數不夠換這張單裡的東西，或換了也不會更省。</p>';
  }
  $('plans').innerHTML = html;
}

function changeCart(id: string, delta: number) {
  if (!state.data) return;
  const next = Math.max(0, Math.min(9, (state.cart[id] ?? 0) + delta));
  const { [id]: _drop, ...rest } = state.cart;
  state.cart = next ? { ...rest, [id]: next } : rest;
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  renderCart(state.data);
  renderPickerGrid(state.data);
  renderPlans(state.data, settings());
}

function render() {
  if (!state.data) return;
  const s = settings();
  renderCart(state.data);
  renderPlans(state.data, s);
  renderPromos(state.data, s);
  renderRank(state.data, s);
  renderDeals(state.data, s);
  renderItems(state.data, s);
}

function useData(data: OfferData, isDraft: boolean) {
  state.data = data;
  $('draft-banner').hidden = !isDraft;
  $<HTMLTextAreaElement>('editor').value = JSON.stringify(data, null, 2);
  $('editor-errors').innerHTML = '';
  renderStamp(data);
  renderCurrencyOptions(data);
  renderPicker(data);
  render();
}

function showErrors(errors: string[]) {
  $('editor-errors').innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
}

function applyDraft() {
  let parsed: unknown;
  try {
    parsed = JSON.parse($<HTMLTextAreaElement>('editor').value);
  } catch (err) {
    showErrors([`JSON 格式錯誤：${(err as Error).message}`]);
    return;
  }
  const errors = validateData(parsed);
  if (errors.length) {
    showErrors(errors);
    return;
  }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(parsed));
  useData(parsed as OfferData, true);
}

function discardDraft() {
  localStorage.removeItem(DRAFT_KEY);
  if (state.repoData) useData(state.repoData, false);
}

function download() {
  if (!state.data) return;
  const blob = new Blob([`${JSON.stringify(state.data, null, 2)}\n`], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'offers.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadDraft(): OfferData | null {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateData(parsed).length ? null : (parsed as OfferData);
  } catch {
    return null;
  }
}

async function main() {
  input('ctl-date').value = todayIn();
  for (const id of ['ctl-date', 'ctl-inactive']) {
    $(id).addEventListener('change', render);
  }
  $('controls').addEventListener('submit', (e) => e.preventDefault());

  input('pick-search').addEventListener('input', (e) => {
    state.pickerQuery = (e.target as HTMLInputElement).value;
    if (state.data) renderPickerGrid(state.data);
  });
  $('pick-tabs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cat]');
    if (!b?.dataset.cat || !state.data) return;
    state.pickerCat = b.dataset.cat;
    state.pickerQuery = '';
    input('pick-search').value = '';
    renderPicker(state.data);
  });
  $('pick-grid').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-add]');
    if (b?.dataset.add) changeCart(b.dataset.add, 1);
  });

  const rerank = () => state.data && renderRank(state.data, settings());
  input('rank-search').addEventListener('input', (e) => {
    state.rank.query = (e.target as HTMLInputElement).value;
    rerank();
  });
  onSeg($('rank-currency'), (v) => {
    state.rank.currency = v;
    rerank();
  });
  onSeg($('rank-kind'), (v) => {
    state.rank.kind = v as RankFilter['kind'];
    rerank();
  });
  onSeg($('rank-sort'), (v) => {
    state.rank.sort = v as RankFilter['sort'];
    rerank();
  });
  input('rank-affordable').addEventListener('change', (e) => {
    state.rank.affordable = (e.target as HTMLInputElement).checked;
    rerank();
  });

  $('cart').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cart]');
    if (btn?.dataset.cart) changeCart(btn.dataset.cart, Number(btn.dataset.delta));
  });
  for (const cur of ['mpoint', 'dotcard']) {
    const el = input(`bal-${cur}`);
    el.value = state.balances[cur] ? String(state.balances[cur]) : '';
    el.addEventListener('change', () => {
      const value = Math.max(0, Math.floor(Number(el.value.replace(/[^\d]/g, '')) || 0));
      el.value = value ? String(value) : '';
      state.balances = { ...state.balances, [cur]: value };
      localStorage.setItem(BAL_KEY, JSON.stringify(state.balances));
      if (state.data) {
        renderPlans(state.data, settings());
        rerank();
      }
    });
  }
  $('btn-apply').addEventListener('click', applyDraft);
  $('btn-download').addEventListener('click', download);
  $('btn-discard').addEventListener('click', discardDraft);
  $('banner-discard').addEventListener('click', discardDraft);

  try {
    // no-cache：部署新資料後不要被瀏覽器快取擋住
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.repoData = (await res.json()) as OfferData;
  } catch (err) {
    $('rank').innerHTML = `<li class="empty">讀不到資料檔（${esc((err as Error).message)}）。</li>`;
    return;
  }

  const draft = loadDraft();
  useData(draft ?? state.repoData, Boolean(draft));
}

void main();
