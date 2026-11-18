import { expect, test } from 'vitest';

import offers from '../public/data/offers.json';
import {
  bestCashPrices,
  dealSummary,
  entryStatus,
  planOrder,
  rankRedemptions,
  todayIn,
  validateData,
} from '../src/calc';
import type { RankRow } from '../src/calc';
import type { OfferData } from '../src/types';

const close = (a: number | null | undefined, b: number) => expect(a).toBeCloseTo(b, 9);

const fixture: OfferData = {
  currencies: [{ id: 'mp', name: 'MP', earnPerDollar: 1 }],
  items: [
    { id: 'fries_s', name: '小薯', price: 40, portionGroup: 'fries', portion: 240 },
    { id: 'fries_l', name: '大薯', price: 66, portionGroup: 'fries', portion: 480 },
    { id: 'cone', name: '蛋捲', price: 18 },
    { id: 'coke_m', name: '中可', price: 38 },
    { id: 'soup', name: '玉米湯', price: 48 },
  ],
  deals: [
    {
      id: 'card',
      name: '甜心卡',
      type: 'bogo',
      fee: 39,
      buy: ['fries_l', 'coke_m'],
      get: ['cone', 'fries_s'],
      start: '2026-03-18',
      end: '2027-03-31',
    },
    {
      id: 'combo',
      name: '大薯兩包',
      type: 'bundle',
      price: 99,
      items: [{ id: 'fries_l', qty: 2 }],
      start: '2026-12-01',
      end: '2026-12-31',
    },
  ],
  redemptions: [
    { id: 'r_fries', currency: 'mp', points: 800, items: [{ id: 'fries_s' }] },
    { id: 'r_cone', currency: 'mp', points: 300, items: [{ id: 'cone' }] },
    { id: 'r_soup', currency: 'mp', points: 1000, items: [{ id: 'soup' }] },
  ],
  promos: [
    {
      id: 'anniv',
      name: '週年慶',
      currency: 'mp',
      start: '2026-11-18',
      end: '2026-11-24',
      rules: [{ items: ['soup'], multiplier: 0.6 }, { multiplier: 0.8 }],
    },
  ],
};

const row = (rows: RankRow[], id: string) => {
  const found = rows.find((r) => r.redemption.id === id);
  if (!found) throw new Error(`沒有 ${id}`);
  return found;
};

test('台北日期不受 UTC 換日影響', () => {
  // UTC 11/17 17:00 = 台北 11/18 01:00
  expect(todayIn('Asia/Taipei', new Date('2026-11-17T17:00:00Z'))).toBe('2026-11-18');
});

test('優惠狀態：常駐、未開始、進行中、快到期、已過期、停用', () => {
  expect(entryStatus({}, '2026-11-18').state).toBe('always');
  expect(entryStatus({ start: '2026-12-01' }, '2026-11-18').state).toBe('upcoming');
  expect(entryStatus({ start: '2026-11-04', end: '2026-11-24' }, '2026-11-18')).toEqual({
    state: 'active',
    daysLeft: 6,
    expiring: true,
  });
  // 到期當天仍可用
  expect(entryStatus({ end: '2026-11-24' }, '2026-11-24').state).toBe('active');
  expect(entryStatus({ end: '2026-11-24' }, '2026-11-25').state).toBe('expired');
  expect(entryStatus({ enabled: false }, '2026-11-18').state).toBe('disabled');
});

test('同類品項照份量拆：大薯＋小薯付 66 元，大薯分到 2/3', () => {
  const prices = bestCashPrices(fixture, '2026-11-18');
  // 大薯配小薯：66 × 480/(480+240) = 44
  close(prices.get('fries_l')?.price, 44);
  // 小薯有同類搭配（大薯）就用那一組：22，不去挑配中可樂的 19.49
  close(prices.get('fries_s')?.price, 22);
  expect(prices.get('fries_s')?.partners).toEqual(['fries_l']);
});

test('不同類照牌價拆，同一組拆完加總等於實付', () => {
  const prices = bestCashPrices(fixture, '2026-11-18');
  // 蛋捲配中可樂：38×18/56
  close(prices.get('cone')?.price, (38 * 18) / 56);
  close((38 * 18) / 56 + (38 * 38) / 56, 38);
});

test('期間限定組合只在期間內影響最便宜現金價', () => {
  const noCard = structuredClone(fixture);
  noCard.deals[0].enabled = false;
  expect(bestCashPrices(noCard, '2026-11-18').get('fries_l')?.price).toBe(66);
  const during = bestCashPrices(noCard, '2026-12-10').get('fries_l');
  expect(during?.price).toBe(49.5);
  expect(during?.via).toBe('combo');
});

test('點數折扣：指定品項 6 折、其他 8 折，只在期間內', () => {
  const on = rankRedemptions(fixture, '2026-11-18');
  expect(row(on, 'r_soup').points).toBe(600);
  expect(row(on, 'r_fries').points).toBe(640);
  const off = rankRedemptions(fixture, '2026-11-25');
  expect(row(off, 'r_fries').points).toBe(800);
  // 8 折時每點牌價價值 40/640
  close(row(on, 'r_fries').perPointList, 40 / 640);
});

test('優惠摘要：卡費幾次回本', () => {
  const s = dealSummary(fixture, fixture.deals[0]);
  // 每次省的就是 B 的牌價：蛋捲 18、小薯 40
  expect(s).toMatchObject({ minSave: 18, maxSave: 40, usesWorst: 3, usesBest: 1 });
});

test('combo：每組挑一個', () => {
  const data = structuredClone(fixture);
  data.deals = [
    {
      id: 'c',
      name: '1+1',
      type: 'combo',
      price: 50,
      groups: [
        ['cone', 'fries_s'],
        ['coke_m', 'soup'],
      ],
    },
  ];
  // 小薯配玉米湯最划算：50×40/88
  close(bestCashPrices(data, '2026-11-18').get('fries_s')?.price, (50 * 40) / 88);
  // 蛋捲＋可樂 56 − 50；小薯＋玉米湯 88 − 50
  expect(dealSummary(data, data.deals[0])).toMatchObject({ minSave: 6, maxSave: 38 });
});

test('combo 折抵型（超值全餐）與多份數組（分享盒）', () => {
  const data = structuredClone(fixture);
  data.deals = [
    { id: 'meal', name: '全餐', type: 'combo', discount: 18, groups: [['soup'], ['coke_m'], ['fries_s']] },
    { id: 'box', name: '分享盒', type: 'combo', price: 99, groups: [{ ids: ['fries_l'], qty: 2 }] },
  ];
  expect(dealSummary(data, data.deals[0])).toMatchObject({ paidMin: 48 + 38 + 40 - 18, minSave: 18 });
  // 套餐裡的小薯按牌價分到 (126−18)×40/126
  close(bestCashPrices(data, '2026-11-18').get('fries_s')?.price, (108 * 40) / 126);
  close(bestCashPrices(data, '2026-11-18').get('fries_l')?.price, 49.5);
});

test('附帶的 offers.json 通過驗證', () => {
  expect(validateData(offers)).toEqual([]);
});

test('驗證抓得到打錯的品項與日期', () => {
  const bad = structuredClone(fixture);
  bad.redemptions.push({
    id: 'x',
    currency: 'nope',
    points: 0,
    items: [{ id: 'ghost' }],
    end: '2026/11/24',
  });
  expect(validateData(bad)).toHaveLength(4);
});

test('點餐推薦：只付現金時挑最省的組合', () => {
  // 想吃中可＋小薯：甜心卡買中可送小薯，付 38（比單點 78 省 40）
  const plan = planOrder(fixture, '2026-11-18', { coke_m: 1, fries_s: 1 });
  expect(plan.listTotal).toBe(78);
  expect(plan.cashOnly.paid).toBe(38);
  const [first] = plan.cashOnly.steps;
  expect(first.kind === 'deal' && first.deal.id).toBe('card');
  expect(plan.withPoints).toBeNull();
});

test('點餐推薦：有點數時用點數換掉一部分', () => {
  // 週年慶期間玉米湯 6 折：1000 → 600 點
  const plan = planOrder(fixture, '2026-11-18', { soup: 1, cone: 1 }, { mp: 700 });
  expect(plan.cashOnly.paid).toBe(66);
  expect(plan.withPoints).toMatchObject({ paid: 18, pointsUsed: { mp: 600 }, cashSaved: 48 });
});

test('點餐推薦：買二送一這種多份數組合也湊得出來', () => {
  const data = structuredClone(fixture);
  data.deals = [
    { id: 'box', name: '分享盒', type: 'combo', price: 99, groups: [{ ids: ['fries_l'], qty: 2 }] },
  ];
  expect(planOrder(data, '2026-11-18', { fries_l: 3 }).cashOnly.paid).toBe(99 + 66);
});

test('多品項兌換的替代價用真的買得到的最低價', () => {
  const data = structuredClone(fixture);
  data.deals = [
    { id: 'meal', name: '全餐', type: 'combo', discount: 18, groups: [['soup'], ['coke_m'], ['fries_s']] },
  ];
  data.redemptions = [
    {
      id: 'r_meal',
      currency: 'mp',
      points: 1000,
      items: [{ id: 'soup' }, { id: 'coke_m' }, { id: 'fries_s' }],
    },
  ];
  data.promos = [];
  const [r] = rankRedemptions(data, '2026-11-18');
  expect(r.altTotal).toBe(48 + 38 + 40 - 18);
  expect(r.viaDeals).toEqual(['meal']);
});

test('大一號比較便宜時，小的價值以大的實際最低價為上限', () => {
  const data: OfferData = {
    currencies: [{ id: 'mp', name: 'MP', earnPerDollar: 1 }],
    items: [
      { id: '可樂-小', name: '小可', price: 33, sizeGroup: '可樂', sizeRank: 1 },
      { id: '可樂-中', name: '中可', price: 38, sizeGroup: '可樂', sizeRank: 2 },
    ],
    // 甜心卡：買中可送中可，一杯等於 19
    deals: [{ id: 'card', name: '甜心卡', type: 'bogo', buy: ['可樂-中'], get: ['可樂-中'] }],
    redemptions: [{ id: 'r', currency: 'mp', points: 300, items: [{ id: '可樂-小' }] }],
  };
  const prices = bestCashPrices(data, '2026-11-18');
  expect(prices.get('可樂-中')?.price).toBe(19);
  expect(prices.get('可樂-小')).toMatchObject({ price: 19, upsize: '可樂-中', via: 'card' });
  // 點數價值跟著用 19 算，而不是小杯牌價 33
  const [r] = rankRedemptions(data, '2026-11-18');
  close(r.perPointAlt, 19 / 300);
});

test('同一樣東西買一送一（中可配中可）算同類搭配，不去挑配美式的', () => {
  const data: OfferData = {
    currencies: [{ id: 'mp', name: 'MP', earnPerDollar: 1 }],
    items: [
      { id: '可樂-中', name: '中可', price: 38, sizeGroup: '可樂', sizeRank: 2 },
      { id: '美式', name: '美式', price: 50 },
    ],
    deals: [
      { id: 'card', name: '甜心卡', type: 'bogo', buy: ['可樂-中'], get: ['可樂-中', '美式'] },
    ],
    redemptions: [],
  };
  const p = bestCashPrices(data, '2026-11-18').get('可樂-中');
  // 配美式會是 38×38/88 ≈ 16.4；同類搭配是 38/2 = 19
  expect(p).toMatchObject({ price: 19, partners: ['可樂-中'] });
});
