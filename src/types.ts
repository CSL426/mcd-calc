// data/offers.json 的形狀。欄位說明見 README。

export type Ymd = string;

export interface Dated {
  start?: Ymd | null;
  end?: Ymd | null;
  enabled?: boolean;
  asOf?: Ymd | null;
  source?: string;
  verified?: boolean;
  note?: string;
}

export interface Currency extends Dated {
  id: string;
  name: string;
  earnPerDollar: number;
}

export interface Item extends Dated {
  id: string;
  name: string;
  price: number;
  category?: string;
  portionGroup?: string;
  portion?: number;
  portionUnit?: string;
  portionSource?: string;
  // 同一種東西的不同大小（可樂小／中、薯條小／中／大、鷄塊 4／6／10 塊），rank 越大份量越多
  sizeGroup?: string;
  sizeRank?: number;
  ref?: string;
  conflict?: string;
}

export interface Line {
  id: string;
  qty?: number;
}

export type Group = string[] | { ids: string[]; qty?: number };

interface DealBase extends Dated {
  id: string;
  name: string;
}

export interface BundleDeal extends DealBase {
  type: 'bundle';
  price: number;
  items: Line[];
}

export interface ComboDeal extends DealBase {
  type: 'combo';
  groups: Group[];
  price?: number;
  discount?: number;
}

export interface BogoDeal extends DealBase {
  type: 'bogo';
  buy: string[];
  get: string[];
  fee?: number;
}

export type Deal = BundleDeal | ComboDeal | BogoDeal;

export interface Redemption extends Dated {
  id: string;
  currency: string;
  points: number;
  cash?: number;
  label?: string;
  items: Line[];
}

export interface PromoRule {
  items?: string[];
  multiplier: number;
}

export interface Promo extends Dated {
  id: string;
  name: string;
  currency: string;
  rules: PromoRule[];
  excludeRedemptions?: string[];
}

export interface OfferData {
  meta?: { note?: string };
  currencies: Currency[];
  items: Item[];
  deals: Deal[];
  redemptions: Redemption[];
  promos?: Promo[];
}

export type Cart = Record<string, number>;
export type Balances = Record<string, number>;
