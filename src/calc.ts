// 純計算邏輯：不碰 DOM，方便單元測試。
// 日期一律用 "YYYY-MM-DD" 字串比較；new Date('2027-03-31') 會被當成 UTC，台灣會差一天。

import type {
  Balances,
  Cart,
  Currency,
  Dated,
  Deal,
  Group,
  Item,
  Line,
  OfferData,
  Promo,
  Redemption,
  Ymd,
} from './types';

export const EXPIRING_DAYS = 7;

export function todayIn(timeZone = 'Asia/Taipei', now = new Date()): Ymd {
  // en-CA 的日期格式剛好是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function dayNumber(ymd: Ymd): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysBetween(fromYmd: Ymd, toYmd: Ymd): number {
  return dayNumber(toYmd) - dayNumber(fromYmd);
}

export type Status =
  | { state: 'disabled' }
  | { state: 'upcoming'; daysUntil: number }
  | { state: 'expired' }
  | { state: 'always' }
  | { state: 'active'; daysLeft: number | null; expiring: boolean };

export function entryStatus(entry: Dated, today: Ymd): Status {
  if (entry.enabled === false) return { state: 'disabled' };
  const { start, end } = entry;
  if (start && today < start) {
    return { state: 'upcoming', daysUntil: daysBetween(today, start) };
  }
  if (end && today > end) return { state: 'expired' };
  if (!start && !end) return { state: 'always' };
  if (!end) return { state: 'active', daysLeft: null, expiring: false };
  const daysLeft = daysBetween(today, end);
  return { state: 'active', daysLeft, expiring: daysLeft <= EXPIRING_DAYS };
}

export function isUsable(entry: Dated, today: Ymd): boolean {
  const { state } = entryStatus(entry, today);
  return state === 'always' || state === 'active';
}

export type ItemMap = Map<string, Item>;

export function itemMap(data: OfferData): ItemMap {
  return new Map(data.items.map((it) => [it.id, it]));
}

function priceOf(items: ItemMap, id: string): number | null {
  const it = items.get(id);
  return it && Number.isFinite(it.price) ? it.price : null;
}

function sumList(items: ItemMap, lines: Line[]): number | null {
  let total = 0;
  for (const { id, qty = 1 } of lines) {
    const p = priceOf(items, id);
    if (p === null) return null;
    total += p * qty;
  }
  return total;
}

// 一次優惠拿到的東西要怎麼拆錢：
// 全部是同一類（同 portionGroup，例如大薯配小薯）就照份量拆，
// 否則照牌價拆（可樂配蛋捲的份量沒辦法比）。
function allocationWeights(items: ItemMap, lines: Line[]): number[] {
  const its = lines.map(({ id }) => items.get(id));
  const group = its[0]?.portionGroup;
  const samePortion =
    Boolean(group) &&
    its.every((it) => it?.portionGroup === group && Number.isFinite(it?.portion));
  return its.map((it) => (samePortion ? (it?.portion ?? 0) : (it?.price ?? 0)));
}

// 組可以寫成 ["a", "b"]（各一個）或 { ids: [...], qty: 2 }
export function normalizeGroup(group: Group): { ids: string[]; qty: number } {
  return Array.isArray(group) ? { ids: group, qty: 1 } : { ids: group.ids, qty: group.qty ?? 1 };
}

export interface Selection {
  lines: Line[];
  paid: number;
  list: number;
  saved: number;
}

// 這個優惠所有可能的拿法
export function dealSelections(items: ItemMap, deal: Deal): Selection[] {
  const out: Selection[] = [];
  const push = (lines: Line[], paid: number | null) => {
    const list = sumList(items, lines);
    if (list === null || paid === null) return;
    out.push({ lines, paid, list, saved: list - paid });
  };

  if (deal.type === 'bundle') {
    push(deal.items, deal.price);
  } else if (deal.type === 'combo') {
    // 每組挑一個，例如 1+1 星級點：紅區一個＋白區一個。
    // 有 price 是固定組合價；有 discount 是「分開買的總價再折多少」（超值全餐）
    let picks: Line[][] = [[]];
    for (const group of deal.groups.map(normalizeGroup)) {
      picks = picks.flatMap((p) => group.ids.map((id) => [...p, { id, qty: group.qty }]));
    }
    for (const lines of picks) {
      const list = sumList(items, lines);
      const paid = Number.isFinite(deal.price)
        ? (deal.price as number)
        : list === null
          ? null
          : list - (deal.discount ?? 0);
      push(lines, paid);
    }
  } else {
    // 付 A 的錢拿到 A+B：甜心卡、買一送一、買全餐送點心都是這型
    for (const aId of deal.buy) {
      for (const bId of deal.get) {
        push([{ id: aId, qty: 1 }, { id: bId, qty: 1 }], priceOf(items, aId));
      }
    }
  }
  return out;
}

function allocate(items: ItemMap, { lines, paid }: Selection): [string, number][] {
  const weights = allocationWeights(items, lines);
  const total = lines.reduce((s, l, i) => s + weights[i] * (l.qty ?? 1), 0);
  if (!total) return [];
  return lines.map((l, i) => [l.id, (paid * weights[i]) / total]);
}

// 同類搭配：同一樣東西（中可買一送一）、同一種的不同大小、或份量可比的同類（大薯配小薯）
function sameKind(items: ItemMap, aId: string, bId: string): boolean {
  if (aId === bId) return true;
  const a = items.get(aId);
  const b = items.get(bId);
  if (a?.sizeGroup && a.sizeGroup === b?.sizeGroup) return true;
  return Boolean(a?.portionGroup) && a?.portionGroup === b?.portionGroup;
}

export interface CashPrice {
  price: number;
  via: string | null;
  partners: string[];
  // 價格其實來自大一號的品項（大的反而比較便宜時）
  upsize?: string;
}

// 每個品項「不花點數時，最便宜可以多少錢拿到一份」。前提：已經有甜心卡。
// 同一個優惠裡如果有同類搭配（大薯配小薯），就用那一組照份量拆，
// 不去挑「大薯配美式」這種只是為了讓數字變小的搭配；沒有同類搭配才取最有利的。
export function bestCashPrices(data: OfferData, today: Ymd): Map<string, CashPrice> {
  const items = itemMap(data);
  const best = new Map<string, CashPrice>();
  const offer = (id: string, price: number, via: string | null, partners: string[]) => {
    const cur = best.get(id);
    if (!cur || price < cur.price - 1e-9) best.set(id, { price, via, partners });
  };

  for (const it of data.items) {
    if (Number.isFinite(it.price)) offer(it.id, it.price, null, []);
  }
  for (const deal of data.deals) {
    if (!isUsable(deal, today)) continue;
    const perItem = new Map<string, { unit: number; partners: string[]; preferred: boolean }[]>();
    for (const sel of dealSelections(items, deal)) {
      for (const [i, [id, unit]] of allocate(items, sel).entries()) {
        // 用位置排除自己那一行；用 id 排除的話，中可配中可會連搭配的那杯一起被刪掉
        const partners = sel.lines.filter((_, j) => j !== i).map((l) => l.id);
        const preferred = partners.some((p) => sameKind(items, id, p));
        const list = perItem.get(id) ?? [];
        list.push({ unit, partners, preferred });
        perItem.set(id, list);
      }
    }
    for (const [id, cands] of perItem) {
      const pool = cands.some((c) => c.preferred) ? cands.filter((c) => c.preferred) : cands;
      const pick = pool.reduce((a, b) => (b.unit < a.unit ? b : a));
      offer(id, pick.unit, deal.id, pick.partners);
    }
  }
  return applyUpsize(data.items, best);
}

// 大一號反而比較便宜時（甜心卡中杯買一送一 $19，小杯牌價 $33），
// 沒有人會花 $33 買小杯，所以小的價值不超過任何更大份量的實際最低價
function applyUpsize(items: Item[], best: Map<string, CashPrice>): Map<string, CashPrice> {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.sizeGroup || !Number.isFinite(it.sizeRank)) continue;
    groups.set(it.sizeGroup, [...(groups.get(it.sizeGroup) ?? []), it]);
  }
  const out = new Map(best);
  for (const members of groups.values()) {
    for (const small of members) {
      for (const big of members) {
        if ((big.sizeRank ?? 0) <= (small.sizeRank ?? 0)) continue;
        const cur = out.get(small.id);
        const cand = best.get(big.id);
        if (cur && cand && cand.price < cur.price - 1e-9) {
          out.set(small.id, { ...cand, upsize: big.id });
        }
      }
    }
  }
  return out;
}

// 點數兌換的期間折扣（例如週年慶 8 折），同一筆兌換取最低的倍率
export function pointsMultiplier(
  data: OfferData,
  redemption: Redemption,
  today: Ymd,
): { multiplier: number; promo: Promo | null } {
  let best: { multiplier: number; promo: Promo | null } = { multiplier: 1, promo: null };
  for (const promo of data.promos ?? []) {
    if (promo.currency !== redemption.currency || !isUsable(promo, today)) continue;
    if ((promo.excludeRedemptions ?? []).includes(redemption.id)) continue;
    const ids = redemption.items.map((l) => l.id);
    const rule = promo.rules.find((r) => !r.items || ids.every((id) => r.items?.includes(id)));
    if (rule && rule.multiplier < best.multiplier) {
      best = { multiplier: rule.multiplier, promo };
    }
  }
  return best;
}

export interface RedemptionValue {
  points: number;
  multiplier: number;
  promo: Promo | null;
  listTotal: number | null;
  altTotal: number | null;
  perPointList: number | null;
  perPointAlt: number | null;
  rebateRate: number | null;
  viaDeals: string[];
  partners: string[];
  upsize?: string;
  currency: Currency | undefined;
}

export function valueRedemption(
  data: OfferData,
  redemption: Redemption,
  cashPrices: Map<string, CashPrice>,
  today: Ymd,
  solve?: Solver,
): RedemptionValue {
  const items = itemMap(data);
  const currency = data.currencies.find((c) => c.id === redemption.currency);
  const { multiplier, promo } = pointsMultiplier(data, redemption, today);
  const points = redemption.points * multiplier;
  const cash = redemption.cash ?? 0;
  const listTotal = sumList(items, redemption.items);

  let altTotal: number | null = 0;
  const viaDeals = new Set<string>();
  let partners: string[] = [];
  let upsize: string | undefined;
  const units = redemption.items.reduce((s, l) => s + (l.qty ?? 1), 0);
  if (units > 1 && solve) {
    // 換套餐這類多品項的：各品項最低分攤價相加是買不到的價格，
    // 要用點餐推薦算出「真的去買這幾樣」最少要付多少
    const cart: Cart = {};
    for (const { id, qty = 1 } of redemption.items) cart[id] = (cart[id] ?? 0) + qty;
    const plan = solve(cart);
    altTotal = Number.isFinite(plan.paid) ? plan.paid : null;
    for (const st of plan.steps) if (st.kind === 'deal') viaDeals.add(st.deal.id);
  } else {
    for (const { id, qty = 1 } of redemption.items) {
      const best = cashPrices.get(id);
      if (!best) {
        altTotal = null;
        break;
      }
      altTotal += best.price * qty;
      if (best.via) viaDeals.add(best.via);
      partners = best.partners;
      upsize = best.upsize;
    }
  }

  const perPoint = (total: number | null) =>
    total === null || !points ? null : (total - cash) / points;
  const perPointAlt = perPoint(altTotal);
  const earn = currency?.earnPerDollar;
  return {
    points,
    multiplier,
    promo,
    listTotal,
    altTotal,
    perPointList: perPoint(listTotal),
    perPointAlt,
    // 回饋率：每花 1 元拿到的點數，換成實際價值是多少錢
    rebateRate:
      perPointAlt === null || earn === undefined || !Number.isFinite(earn)
        ? null
        : perPointAlt * earn,
    viaDeals: [...viaDeals],
    partners,
    upsize,
    currency,
  };
}

export interface RankRow extends RedemptionValue {
  redemption: Redemption;
  status: Status;
  usable: boolean;
}

export function rankRedemptions(data: OfferData, today: Ymd): RankRow[] {
  const cashPrices = bestCashPrices(data, today);
  const solve = cashPlanner(data, today);
  const rows: RankRow[] = data.redemptions.map((r) => ({
    redemption: r,
    status: entryStatus(r, today),
    usable: isUsable(r, today),
    ...valueRedemption(data, r, cashPrices, today, solve),
  }));
  // 不同點數的「每點價值」尺度差很多，跨幣別排序要用回饋率；同幣別時兩者順序一樣
  const key = (row: RankRow) => (row.rebateRate === null ? -Infinity : row.rebateRate);
  return rows.sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    return key(b) - key(a);
  });
}

export interface DealSummary {
  paidMin: number;
  paidMax: number;
  minSave: number;
  maxSave: number;
  minRate: number;
  maxRate: number;
  fee: number;
  usesBest: number | null;
  usesWorst: number | null;
}

// 優惠卡片用：每次最少／最多省多少，卡費要用幾次回本
export function dealSummary(data: OfferData, deal: Deal): DealSummary | null {
  const items = itemMap(data);
  const sels = dealSelections(items, deal).filter((s) => s.list > 0);
  if (!sels.length) return null;
  const saved = sels.map((s) => s.saved);
  const rates = sels.map((s) => s.saved / s.list);
  const minSave = Math.min(...saved);
  const maxSave = Math.max(...saved);
  const fee = deal.type === 'bogo' ? (deal.fee ?? 0) : 0;
  return {
    paidMin: Math.min(...sels.map((s) => s.paid)),
    paidMax: Math.max(...sels.map((s) => s.paid)),
    minSave,
    maxSave,
    minRate: Math.min(...rates),
    maxRate: Math.max(...rates),
    fee,
    usesBest: fee && maxSave > 0 ? Math.ceil(fee / maxSave) : null,
    usesWorst: fee && minSave > 0 ? Math.ceil(fee / minSave) : null,
  };
}

// 套用草稿前的基本檢查，回傳錯誤訊息陣列。輸入來自使用者貼的 JSON，所以當 unknown 處理。
export function validateData(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return ['不是 JSON 物件'];
  const data = input as Record<string, unknown>;
  for (const key of ['currencies', 'items', 'deals', 'redemptions']) {
    if (!Array.isArray(data[key])) errors.push(`缺少陣列 ${key}`);
  }
  if (data.promos !== undefined && !Array.isArray(data.promos)) {
    errors.push('promos 要是陣列');
  }
  if (errors.length) return errors;

  // 陣列已確認存在；以下逐欄檢查，所以先放寬成 any 再一一驗
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 外部 JSON，逐欄驗證
  const d = data as any;
  const ids = new Set<string>(d.items.map((it: Item) => it.id));
  const currencyIds = new Set<string>(d.currencies.map((c: Currency) => c.id));
  const dateOk = (v: unknown) => v == null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const checkIds = (where: string, list: string[] | undefined) => {
    for (const id of list ?? []) {
      if (!ids.has(id)) errors.push(`${where} 用到不存在的品項 ${id}`);
    }
  };
  const checkDates = (where: string, e: Dated) => {
    if (!dateOk(e.start) || !dateOk(e.end) || !dateOk(e.asOf)) {
      errors.push(`${where} 日期要寫成 YYYY-MM-DD`);
    }
  };

  for (const it of d.items) checkDates(`品項 ${it.id}`, it);
  for (const deal of d.deals) {
    const where = `優惠 ${deal.id}`;
    checkDates(where, deal);
    if (deal.type === 'bundle') checkIds(where, (deal.items ?? []).map((l: Line) => l.id));
    else if (deal.type === 'combo') {
      if (!Array.isArray(deal.groups)) errors.push(`${where} 需要 groups 陣列`);
      else deal.groups.forEach((g: Group) => checkIds(where, normalizeGroup(g).ids));
      if (!Number.isFinite(deal.price) && !Number.isFinite(deal.discount)) {
        errors.push(`${where} 需要 price 或 discount`);
      }
    } else if (deal.type === 'bogo') {
      if (!Array.isArray(deal.buy) || !Array.isArray(deal.get)) {
        errors.push(`${where} 需要 buy 與 get 陣列`);
        continue;
      }
      checkIds(where, deal.buy);
      checkIds(where, deal.get);
    } else errors.push(`${where} 的 type 要是 bundle、combo 或 bogo`);
  }
  for (const r of d.redemptions) {
    const where = `兌換 ${r.id}`;
    if (!currencyIds.has(r.currency)) errors.push(`${where} 的點數種類 ${r.currency} 不存在`);
    if (!(r.points > 0)) errors.push(`${where} 的點數要大於 0`);
    checkDates(where, r);
    checkIds(where, (r.items ?? []).map((l: Line) => l.id));
  }
  for (const p of d.promos ?? []) {
    const where = `點數折扣 ${p.id}`;
    if (!currencyIds.has(p.currency)) errors.push(`${where} 的點數種類 ${p.currency} 不存在`);
    checkDates(where, p);
    if (!Array.isArray(p.rules) || !p.rules.length) {
      errors.push(`${where} 需要 rules 陣列`);
      continue;
    }
    for (const rule of p.rules) {
      if (!(rule.multiplier > 0 && rule.multiplier <= 1)) {
        errors.push(`${where} 的 multiplier 要介於 0 和 1`);
      }
      checkIds(where, rule.items);
    }
  }
  return errors;
}

// ── 點餐推薦：給想吃的東西，找出最省的點法 ──
// cart: { [itemId]: qty }。只湊剛好想吃的東西，不推薦多買。

export type Step =
  | { kind: 'single'; lines: Line[]; paid: number | null }
  | { kind: 'deal'; deal: Deal; lines: Line[]; paid: number; saved: number }
  | {
      kind: 'redeem';
      redemption: Redemption;
      lines: Line[];
      paid: number;
      points: number;
      currency: string;
      promo: Promo | null;
    };

export interface Plan {
  paid: number;
  steps: Step[];
}

export type Solver = (cart: Cart) => Plan;

const cartKey = (cart: Cart) =>
  Object.keys(cart)
    .filter((id) => cart[id] > 0)
    .sort()
    .map((id) => `${id}:${cart[id]}`)
    .join('|');

function fits(cart: Cart, lines: Line[]): boolean {
  const need: Cart = {};
  for (const { id, qty = 1 } of lines) need[id] = (need[id] ?? 0) + qty;
  return Object.entries(need).every(([id, q]) => (cart[id] ?? 0) >= q);
}

function minus(cart: Cart, lines: Line[]): Cart {
  const out = { ...cart };
  for (const { id, qty = 1 } of lines) out[id] -= qty;
  return out;
}

// 所有現在能用、而且真的有省到錢的優惠拿法
function usableSelections(data: OfferData, today: Ymd) {
  const items = itemMap(data);
  return data.deals
    .filter((d) => isUsable(d, today))
    .flatMap((deal) =>
      dealSelections(items, deal)
        .filter((s) => s.saved > 1e-9)
        .map((s) => ({ ...s, deal })),
    );
}

function cashPlanner(data: OfferData, today: Ymd): Solver {
  const items = itemMap(data);
  const sels = usableSelections(data, today);
  const memo = new Map<string, Plan>();

  const solve: Solver = (cart) => {
    const key = cartKey(cart);
    if (!key) return { paid: 0, steps: [] };
    const hit = memo.get(key);
    if (hit) return hit;

    // 每次處理排序後的第一個品項：它要嘛單點，要嘛被某個優惠帶走
    const first = key.split('|')[0].split(':')[0];
    const price = priceOf(items, first);
    const single = solve(minus(cart, [{ id: first, qty: 1 }]));
    let best: Plan = {
      paid: (price ?? Infinity) + single.paid,
      steps: [{ kind: 'single', lines: [{ id: first, qty: 1 }], paid: price }, ...single.steps],
    };
    for (const s of sels) {
      if (!s.lines.some((l) => l.id === first) || !fits(cart, s.lines)) continue;
      const rest = solve(minus(cart, s.lines));
      const paid = s.paid + rest.paid;
      if (paid < best.paid - 1e-9) {
        best = {
          paid,
          steps: [
            { kind: 'deal', deal: s.deal, lines: s.lines, paid: s.paid, saved: s.saved },
            ...rest.steps,
          ],
        };
      }
    }
    memo.set(key, best);
    return best;
  };
  return solve;
}

export interface OrderPlan {
  listTotal: number | null;
  cashOnly: Plan;
  withPoints: (Plan & { pointsUsed: Balances; cashSaved: number }) | null;
}

// balances: { [currencyId]: 手上的點數 }
export function planOrder(
  data: OfferData,
  today: Ymd,
  cart: Cart,
  balances: Balances = {},
): OrderPlan {
  const items = itemMap(data);
  const solve = cashPlanner(data, today);
  const clean: Cart = Object.fromEntries(
    Object.entries(cart).filter(([id, q]) => q > 0 && items.has(id)),
  );
  const listTotal = sumList(
    items,
    Object.entries(clean).map(([id, qty]) => ({ id, qty })),
  );
  const cashOnly = solve(clean);

  // 能用的兌換：在期間內、點數夠、品項在想吃的清單裡
  const redeems = data.redemptions
    .filter((r) => isUsable(r, today) && (balances[r.currency] ?? 0) > 0)
    .map((r) => {
      const { multiplier, promo } = pointsMultiplier(data, r, today);
      return { r, promo, points: Math.round(r.points * multiplier) };
    })
    .filter((x) => x.points <= balances[x.r.currency] && fits(clean, x.r.items));

  // 列舉要用哪些兌換（可重複），剩下的交給現金最佳解；想吃的東西不多，直接窮舉
  let best = { ...cashOnly, used: {} as Balances, redeemSteps: [] as Step[] };
  const sum = (b: Balances) => Object.values(b).reduce((a, x) => a + x, 0);
  let visited = 0;
  const dfs = (cur: Cart, left: Balances, start: number, steps: Step[], used: Balances) => {
    if (++visited > 50000) return;
    const rest = solve(cur);
    const cashPaid = rest.paid + steps.reduce((s, x) => s + (x.paid ?? 0), 0);
    const better = cashPaid < best.paid - 1e-9;
    const tieFewer = Math.abs(cashPaid - best.paid) < 1e-9 && sum(used) < sum(best.used);
    if (better || tieFewer) {
      best = { paid: cashPaid, steps: rest.steps, used: { ...used }, redeemSteps: [...steps] };
    }
    for (let i = start; i < redeems.length; i++) {
      const x = redeems[i];
      const c = x.r.currency;
      if (x.points > left[c] || !fits(cur, x.r.items)) continue;
      dfs(
        minus(cur, x.r.items),
        { ...left, [c]: left[c] - x.points },
        i,
        [
          ...steps,
          {
            kind: 'redeem',
            redemption: x.r,
            lines: x.r.items,
            paid: x.r.cash ?? 0,
            points: x.points,
            currency: c,
            promo: x.promo,
          },
        ],
        { ...used, [c]: (used[c] ?? 0) + x.points },
      );
    }
  };
  if (redeems.length) dfs(clean, { ...balances }, 0, [], {});

  const withPoints = best.redeemSteps.length
    ? {
        paid: best.paid,
        steps: [...best.redeemSteps, ...best.steps],
        pointsUsed: best.used,
        // 這次用點數比只付現金少花的錢
        cashSaved: cashOnly.paid - best.paid,
      }
    : null;
  return { listTotal, cashOnly, withPoints };
}
