"""一次性：把速速湊整理的麥當勞品項／優惠，加上自己查的 M Point 資料，寫成 data/offers.json。

之後直接改 data/offers.json 即可，不需要再跑這支（再跑會蓋掉手動修改）。
"""
import json
from pathlib import Path

# 速速湊是轉手彙整，不是原始來源：它自稱價格取自官方公告與多家菜單、兩家以上一致才採用，
# 但沒有逐筆標來源與日期。所以這裡拿另一份有日期的獨立整理（cashfeel）交叉比對，
# 一致的才標 cashfeel 的日期；只有速速湊有的，日期就是「不明」。
VIA_SUSUGO = "經速速湊彙整（它註明取自官方公告與多家菜單，未逐筆標來源與日期）"
CASHFEEL = "cashfeel《2026 麥當勞菜單》，11/05 更新"
CASHFEEL_ASOF = "2026-11-05"
OFFICIAL_NOTE = "麥當勞官網餐點注意事項（2026-11-18 查）"
OFFICIAL_PRODUCT = "https://www.mcdonalds.com/tw/zh-tw/product/"

# cashfeel 11/05 版的單點價，用來和速速湊比對
CASHFEEL_PRICES = {
    "薯條-小": 40, "薯條-中": 50, "薯條-大": 66, "薯餅": 37, "蛋捲冰淇淋": 18,
    "大蛋捲冰淇淋": 32, "OREO冰炫風": 59, "麥克雞塊-4塊": 48, "麥克雞塊-6塊": 68,
    "麥克雞塊-10塊": 109, "玉米濃湯-大": 58, "可口可樂-小": 33, "可口可樂-中": 38,
    "雪碧-小": 33, "雪碧-中": 38, "可口可樂Zero-小": 33, "可口可樂Zero-中": 38,
    "冰紅茶檸檬風味-小": 33, "熱紅茶-中": 38, "經典美式咖啡-熱-中": 50, "經典美式咖啡-冰-中": 67,
    "經典那堤-熱-中": 77, "經典那堤-冰-中": 77, "勁辣香雞翅": 49, "蘋果派": 40, "四季沙拉-大": 55,
    "吉事漢堡": 48, "無糖冰紅茶-小": 35, "無糖冰綠茶-小": 35, "無糖冰紅茶-中": 43,
    "無糖冰綠茶-中": 43, "冰奶茶-大": 51, "熱奶茶-中": 51, "焦糖冰奶茶-大": 68,
    "冰蜂蜜紅茶-大": 56, "冰蜂蜜奶茶-大": 66, "熱蜂蜜奶茶-中": 66, "大麥克": 78,
    "海苔風味搖搖薯條": 69, "巧克力三角派": 50, "黑森林冰炫風": 69, "松露安格斯牛肉黑堡": 109,
    "松露脆雞腿黑堡": 109, "金薯松露安格斯牛肉黑堡": 119, "金薯松露脆雞腿黑堡": 119,
    "煙燻勁脆雞腿堡": 99,
}

# 官網注意事項裡直接寫了單點價的
OFFICIAL_PRICES = {"經典美式咖啡-熱-中": 50, "經典美式咖啡-冰-中": 50,
                   "金選美式-熱-中": 60, "金選美式-冰-中": 60}

# 速速湊附的官網商品頁（只證明品項存在，官網商品頁沒有標價）
REFS = dict(pair.split("=") for pair in (
    "大麥克=big-mac|雙層牛肉吉事堡=double-cheese-burger|四盎司牛肉堡=classic-angus-beef-burger|"
    "雙層四盎司牛肉堡=double-classic-angus-beef-burger|BLT安格斯黑牛堡=blt-angus-beef-burger|"
    "蕈菇安格斯黑牛堡=mushroom-angus-beef-burger|辣味四盎司牛肉堡=spicy-classic-angus-beef-burger|"
    "辣味雙層四盎司牛肉堡=spicy-classic-double-angus-beef-burger|麥香雞=mcchicken|"
    "勁辣雞腿堡=spicy-chicken-filet-burger|煙燻勁脆雞腿堡=smoky-McCrispy-burger|"
    "肯瓊勁脆雞腿堡=cajun-McCrispy-burger|炭燒醬烤雞腿堡=smoky-grilled-chicken-burger|"
    "BLT香烙烤雞腿堡=blt-grilled-chicken-burger-n|麥香魚=filet-o-fish|雙層麥香魚=double-filet-o-fish-regular|"
    "藜麥沙拉=quinoa-salad|藜麥辣脆雞沙拉=quinoa-salad-with-spicy-fried-chicken-filet|"
    "藜麥鱈魚沙拉=quinoa-salad-with-fish-filet|藜麥香烙烤雞沙拉=quinoa-salad-with-grilled-chicken-filet-n|"
    "麥克雞塊-4塊=chicken-mcnuggets-4-pieces|麥克雞塊-6塊=chicken-mcnuggets-6-pieces|"
    "麥克雞塊-10塊=chicken-mcnuggets-10-pieces|麥脆雞腿-1塊=chicken-mccrispy-thigh-1-pieces|"
    "麥脆雞腿-2塊=chicken-mccrispy-2-pieces|勁辣香雞翅=spicy-chicken-wing-2-pieces|吉事漢堡=cheese-burger|"
    "麥克雙牛堡=McDouble|蘋果派=apple-pie|薯條-小=french-fries-small|薯條-中=french-fries-medium|"
    "薯條-大=french-fries-large|薯餅=hash-browns|玉米濃湯-大=corn-soup-large|四季沙拉-大=salad-large|"
    "可口可樂-小=coke|可口可樂-中=coke-medium|可口可樂Zero-小=coke-zero|可口可樂Zero-中=coke-zero-medium|"
    "雪碧-小=sprite|雪碧-中=sprite-medium|冰紅茶檸檬風味-小=iced-black-tea-lemon-flavor|"
    "冰紅茶檸檬風味-中=iced-black-tea-lemon-flavor-medium|無糖冰紅茶-小=iced-black-tea-sugar-free|"
    "無糖冰紅茶-中=iced-black-tea-sugar-free-medium|無糖冰綠茶-小=iced-green-tea-sugar-free|"
    "無糖冰綠茶-中=iced-green-tea-sugar-free-medium|熱紅茶-中=hot-black-tea|熱奶茶-中=hot-milk-tea-medium|"
    "冰奶茶-大=iced-milk-tea-large|經典美式咖啡-熱-中=americano|經典美式咖啡-冰-中=iced-americano|"
    "經典卡布奇諾-熱-中=cappuccino|經典卡布奇諾-冰-中=iced-cappuccino|經典那堤-熱-中=latte|"
    "經典那堤-冰-中=iced-latte|金選那堤-熱-中=select-brew-latte|金選那堤-冰-中=iced-select-brew-latte|"
    "金選美式-熱-中=select-brew-americano|金選美式-冰-中=iced-select-brew-americano|"
    "冰蜂蜜紅茶-大=honey-black-tea-iced|冰蜂蜜奶茶-大=honey-milk-tea-iced|熱蜂蜜奶茶-中=honey-milk-tea-hot|"
    "焦糖冰奶茶-大=caramel-milk-tea-iced|蛋捲冰淇淋=ice-cream-cone|大蛋捲冰淇淋=ice-cream-cone-large|"
    "OREO冰炫風=mcflurry|雙倍OREO冰炫風=double-oreo-mcflurry|豬肉滿福堡=sausage-mcmuffin|"
    "豬肉滿福堡加蛋=sausage-mcmuffin-with-egg|無敵豬肉滿福堡加蛋=mega-mcmuffin|滿福堡=egg-mcmuffin|"
    "青蔬滿福堡=muffin-with-vegetables|豬肉蛋堡=egg-burger-with-sausage|"
    "火腿蛋堡=egg-burger-with-canadian-bacon|吉事蛋堡=egg-burger|蕈菇嫩蛋焙果堡=bagel-burger-with-mushroom|"
    "番茄嫩蛋焙果堡=bagel-burger-with-cheese|鬆餅-3片=hotcakes-3-pieces|豬肉鬆餅=hotcakes-with-sausage|"
    "雞塊鬆餅大早餐=grand-breakfast"
).split("|"))

ITEMS = """
薯條-小 薯條 40 點心|薯條-中 薯條 50 點心|薯條-大 薯條 66 點心|蛋捲冰淇淋 蛋捲冰淇淋 18 甜點冰品
|麥克雞塊-4塊 麥克鷄塊 48 點心|麥克雞塊-6塊 麥克鷄塊 68 點心|麥克雞塊-10塊 麥克鷄塊 109 點心
|勁辣雞腿堡 勁辣鷄腿堡 78 主餐|大麥克 大麥克 78 主餐|OREO冰炫風 OREO冰炫風 59 甜點冰品
|雙層牛肉吉事堡 雙層牛肉吉事堡 72 主餐|四盎司牛肉堡 四盎司牛肉堡 92 主餐|雙層四盎司牛肉堡 雙層四盎司牛肉堡 132 主餐
|辣味四盎司牛肉堡 辣味四盎司牛肉堡 92 主餐|辣味雙層四盎司牛肉堡 辣味雙層四盎司牛肉堡 132 主餐
|BLT安格斯黑牛堡 BLT安格斯牛肉堡 122 主餐|蕈菇安格斯黑牛堡 蕈菇安格斯牛肉堡 132 主餐|麥香雞 麥香鷄 48 主餐
|麥脆雞腿-2塊 麥脆鷄腿 126 點心|煙燻勁脆雞腿堡 煙燻勁脆鷄腿堡 99 主餐|肯瓊勁脆雞腿堡 肯瓊勁脆鷄腿堡 99 主餐
|炭燒醬烤雞腿堡 炭燒醬烤鷄腿堡 99 主餐|BLT香烙烤雞腿堡 BLT香烙烤鷄腿堡 129 主餐|麥香魚 麥香魚 52 主餐
|雙層麥香魚 雙層麥香魚 92 主餐|藜麥沙拉 藜麥沙拉 109 主餐|藜麥辣脆雞沙拉 藜麥辣脆鷄沙拉 139 主餐
|藜麥香烙烤雞沙拉 藜麥香烙烤鷄沙拉 159 主餐|藜麥鱈魚沙拉 藜麥鱈魚沙拉 139 主餐
|可口可樂-中 可口可樂 38 飲料|可口可樂Zero-中 可口可樂Zero 38 飲料|雪碧-中 雪碧 38 飲料|熱紅茶-中 熱紅茶 38 飲料
|四季沙拉-大 四季沙拉 55 點心|麥脆雞腿-1塊 麥脆鷄腿 68 點心|海苔風味搖搖薯條 海苔風味搖搖薯條 69 點心
|吉事漢堡 吉事漢堡 48 點心|勁辣香雞翅 勁辣香鷄翅（2塊） 49 點心|蘋果派 蘋果派 40 點心|大蛋捲冰淇淋 大蛋捲冰淇淋 32 甜點冰品
|可口可樂-小 可口可樂 33 飲料|可口可樂Zero-小 可口可樂Zero 33 飲料|雪碧-小 雪碧 33 飲料
|冰紅茶檸檬風味-小 冰紅茶（檸檬風味） 33 飲料|無糖冰紅茶-小 無糖冰紅茶 35 飲料|無糖冰綠茶-小 無糖冰綠茶 35 飲料
|麥克雙牛堡 麥克雙牛堡 60 點心
|金選那堤-熱-中 金選那堤 87 McCafé|金選那堤-冰-中 金選那堤 87 McCafé|金選美式-熱-中 金選美式咖啡 60 McCafé
|金選美式-冰-中 金選美式咖啡 60 McCafé|經典那堤-熱-中 經典那堤 77 McCafé|經典那堤-冰-中 經典那堤 77 McCafé
|經典卡布奇諾-熱-中 經典卡布奇諾 61 McCafé|經典卡布奇諾-冰-中 經典卡布奇諾 77 McCafé
|經典美式咖啡-熱-中 經典美式咖啡 50 McCafé|經典美式咖啡-冰-中 經典美式咖啡 50 McCafé
|冰蜂蜜紅茶-大 冰蜂蜜紅茶 58 McCafé|冰蜂蜜奶茶-大 冰蜂蜜奶茶 68 McCafé|熱蜂蜜奶茶-中 熱蜂蜜奶茶 68 McCafé
|焦糖冰奶茶-大 焦糖冰奶茶 68 McCafé|冰奶茶-大 冰奶茶 50 飲料|冰紅茶檸檬風味-中 冰紅茶（檸檬風味） 41 飲料
|無糖冰紅茶-中 無糖冰紅茶 43 飲料|無糖冰綠茶-中 無糖冰綠茶 43 飲料|玉米濃湯-大 玉米濃湯 58 點心
|雙倍OREO冰炫風 雙倍OREO冰炫風 65 甜點冰品|熱奶茶-中 熱奶茶 50 飲料|薯餅 薯餅 37 點心
|豬肉滿福堡 豬肉滿福堡 50 早餐|豬肉滿福堡加蛋 豬肉滿福堡加蛋 60 早餐|無敵豬肉滿福堡加蛋 無敵豬肉滿福堡加蛋 80 早餐
|滿福堡 滿福堡 52 早餐|青蔬滿福堡 青蔬滿福堡 60 早餐|豬肉蛋堡 豬肉蛋堡 64 早餐|火腿蛋堡 火腿蛋堡 52 早餐
|吉事蛋堡 吉事蛋堡 34 早餐|蕈菇嫩蛋焙果堡 蕈菇嫩蛋焙果堡 91 早餐|番茄嫩蛋焙果堡 番茄嫩蛋焙果堡 71 早餐
|鬆餅-3片 鬆餅 57 早餐|豬肉鬆餅 豬肉鬆餅 71 早餐|雞塊鬆餅大早餐 麥克鷄塊鬆餅 111 早餐
|酪梨醬無敵豬肉滿福堡加蛋 酪梨醬無敵豬肉滿福堡加蛋 105 早餐|酪梨醬豬肉滿福堡加蛋 酪梨醬豬肉滿福堡加蛋 85 早餐
|酪梨醬豬肉滿福堡 酪梨醬豬肉滿福堡 75 早餐|酪梨醬滿福堡 酪梨醬滿福堡 77 早餐|酪梨醬青蔬滿福堡 酪梨醬青蔬滿福堡 85 早餐
|金薯松露安格斯牛肉黑堡 金薯松露安格斯牛肉黑堡 119 主餐|金薯松露脆雞腿黑堡 金薯松露脆鷄腿黑堡 119 主餐
|松露安格斯牛肉黑堡 松露安格斯牛肉黑堡 109 主餐|松露脆雞腿黑堡 松露脆鷄腿黑堡 109 主餐
|藜麥黑脆雞沙拉 藜麥黑脆鷄沙拉 149 主餐|黑森林冰炫風 黑森林冰炫風 69 甜點冰品|巧克力三角派 巧克力三角派 50 點心
"""

# 份量：同一類的品項（大薯配小薯、4 塊配 10 塊鷄塊）在同一個優惠裡照份量拆錢
PORTIONS = {
    # 官網營養資訊只給熱量、沒有重量；同一種薯條的熱量和份量成正比
    "薯條-小": ("fries", 240.94, "kcal", "麥當勞官網營養資訊（2026-11-18 查）"),
    "薯條-大": ("fries", 472.57, "kcal", "麥當勞官網營養資訊（2026-11-18 查）"),
    "麥克雞塊-4塊": ("nuggets", 4, "塊", "品名"),
    "麥克雞塊-6塊": ("nuggets", 6, "塊", "品名"),
    "麥克雞塊-10塊": ("nuggets", 10, "塊", "品名"),
}

MAINS = ("大麥克 雙層牛肉吉事堡 四盎司牛肉堡 雙層四盎司牛肉堡 辣味四盎司牛肉堡 辣味雙層四盎司牛肉堡 "
         "BLT安格斯黑牛堡 蕈菇安格斯黑牛堡 麥香雞 勁辣雞腿堡 麥克雞塊-6塊 麥克雞塊-10塊 麥脆雞腿-2塊 "
         "煙燻勁脆雞腿堡 肯瓊勁脆雞腿堡 炭燒醬烤雞腿堡 BLT香烙烤雞腿堡 麥香魚 雙層麥香魚 藜麥沙拉 "
         "藜麥辣脆雞沙拉 藜麥香烙烤雞沙拉 藜麥鱈魚沙拉").split()
DRINK38 = "可口可樂-中 可口可樂Zero-中 雪碧-中 熱紅茶-中".split()
WHITE = "可口可樂-小 可口可樂Zero-小 雪碧-小 冰紅茶檸檬風味-小 無糖冰紅茶-小 無糖冰綠茶-小 熱紅茶-中".split()
BREAKFAST = ("豬肉滿福堡 豬肉滿福堡加蛋 無敵豬肉滿福堡加蛋 滿福堡 青蔬滿福堡 豬肉蛋堡 火腿蛋堡 吉事蛋堡 "
             "蕈菇嫩蛋焙果堡 番茄嫩蛋焙果堡 鬆餅-3片 豬肉鬆餅 雞塊鬆餅大早餐").split()
AVOCADO = "酪梨醬無敵豬肉滿福堡加蛋 酪梨醬豬肉滿福堡加蛋 酪梨醬豬肉滿福堡 酪梨醬滿福堡 酪梨醬青蔬滿福堡".split()
TRUFFLE = "金薯松露安格斯牛肉黑堡 金薯松露脆雞腿黑堡 松露安格斯牛肉黑堡 松露脆雞腿黑堡 藜麥黑脆雞沙拉".split()
GOLD_TRUFFLE = TRUFFLE[:2]
APP_SRC = "麥當勞官網 APP 回饋頁、蘋果仁 2026 麥當勞 11 月優惠整理"
LINE_SRC = "蘋果仁 2026 麥當勞 11 月優惠整理"


def g(ids, qty=1):
    return {"ids": ids if isinstance(ids, list) else [ids], "qty": qty}


DEAL_SRC = f"組合規則：{OFFICIAL_NOTE}；內容與金額{VIA_SUSUGO}"


def combo(id_, name, groups, price=None, discount=None, start=None, end=None,
          note="", source=DEAL_SRC, as_of=None):
    d = {"id": id_, "name": name, "type": "combo", "groups": groups}
    if price is not None:
        d["price"] = price
    if discount is not None:
        d["discount"] = discount
    d.update(start=start, end=end, note=note, source=source, asOf=as_of,
             verified=False)
    return d


SIZE_RANK = {"小": 1, "中": 2, "大": 3}


def size_of(id_):
    """同一種東西的大小：可樂-小／中、薯條-小／中／大、麥克雞塊-4／6／10塊、蛋捲／大蛋捲。"""
    if id_ in ("蛋捲冰淇淋", "大蛋捲冰淇淋"):
        return ("蛋捲冰淇淋", 1 if id_ == "蛋捲冰淇淋" else 2)
    base, _, last = id_.rpartition("-")
    if not base:
        return None
    if last in SIZE_RANK:
        return (base, SIZE_RANK[last])
    if last.endswith("塊") and last[:-1].isdigit():
        return (base, int(last[:-1]))
    return None


def build_items():
    items = []
    for chunk in ITEMS.split("|"):
        id_, name, price, cat = chunk.split()
        size = id_.split("-", 1)[1] if "-" in id_ else ""
        label = f"{name}（{size}）" if size else name
        price = int(price)
        item = {"id": id_, "name": label, "price": price, "category": cat}
        cf = CASHFEEL_PRICES.get(id_)
        if OFFICIAL_PRICES.get(id_) == price:
            item.update(source=OFFICIAL_NOTE, asOf="2026-11-18")
        elif cf == price:
            item.update(source=f"{CASHFEEL}；{VIA_SUSUGO}，兩邊一致", asOf=CASHFEEL_ASOF)
        else:
            item.update(source=VIA_SUSUGO, asOf=None)
        if cf is not None and cf != price:
            item["conflict"] = f"{CASHFEEL} 寫 ${cf}"
        if id_ in REFS:
            item["ref"] = OFFICIAL_PRODUCT + REFS[id_] + ".html"
        item["verified"] = False
        size = size_of(id_)
        if size:
            item.update(sizeGroup=size[0], sizeRank=size[1])
        if id_ in PORTIONS:
            grp, amount, unit, src = PORTIONS[id_]
            item.update(portionGroup=grp, portion=amount, portionUnit=unit,
                        portionSource=src)
        items.append(item)
    return items


def build_deals():
    vm = "主餐 + 中杯 $38 飲料 + {}，套餐價 = 主餐單點 + ${}（折 ${}）"
    fries_m, fries_l = "薯條-中", "薯條-大"
    n10 = "麥克雞塊-10塊"
    seaweed = "海苔風味搖搖薯條"
    halloween = ("2026-10-21", "2026-11-24")
    return [
        combo("value-meal-a", "超值全餐 A 經典配餐", [g(MAINS), g(DRINK38), g(fries_m)],
              discount=18, note=vm.format("中薯", 70, 18)),
        combo("value-meal-b", "超值全餐 B 清爽配餐", [g(MAINS), g(DRINK38), g("四季沙拉-大")],
              discount=18, note=vm.format("四季沙拉（大）", 75, 18)),
        combo("value-meal-c", "超值全餐 C 勁脆配餐", [g(MAINS), g(DRINK38), g("麥脆雞腿-1塊")],
              discount=17, note=vm.format("麥脆鷄腿 1 塊", 89, 17)),
        combo("value-meal-d", "超值全餐 D 炫冰配餐",
              [g(MAINS), g(DRINK38), g("薯條-小"), g("OREO冰炫風")],
              discount=33, note=vm.format("小薯 + OREO 冰炫風", 104, 33)),
        combo("value-meal-e", "超值全餐 E 豪吃配餐",
              [g(MAINS), g(DRINK38), g("薯條-小"), g("麥克雞塊-6塊")],
              discount=42, note=vm.format("小薯 + 6 塊麥克鷄塊", 104, 42)),
        combo("value-meal-seaweed", "超值全餐 海苔搖搖薯條配餐",
              [g(MAINS), g(DRINK38), g(seaweed)], discount=21, start=halloween[0],
              end=halloween[1], note=vm.format("海苔風味搖搖薯條", 86, 21)),
        combo("one-plus-one-50", "1+1 星級點 $50",
              [g("吉事漢堡 麥香雞 麥克雞塊-4塊 勁辣香雞翅 薯條-小 蘋果派 大蛋捲冰淇淋".split()), g(WHITE)],
              price=50, note="紅區任選一個 + 白區飲料任選一個；10:30 至凌晨供應"),
        combo("one-plus-one-69", "1+1 星級點 $69",
              [g("麥克雙牛堡 麥香魚 麥克雞塊-6塊 麥脆雞腿-1塊 OREO冰炫風".split()), g(WHITE)],
              price=69, note="紅區任選一個 + 白區飲料任選一個；10:30 至凌晨供應"),
        {
            "id": "sweet-card", "name": "甜心卡（買 A 送 B）", "type": "bogo", "fee": 39,
            "buy": ("金選那堤-熱-中 金選那堤-冰-中 金選美式-熱-中 金選美式-冰-中 經典那堤-熱-中 經典那堤-冰-中 "
                    "經典卡布奇諾-熱-中 經典卡布奇諾-冰-中 經典美式咖啡-熱-中 經典美式咖啡-冰-中 冰蜂蜜紅茶-大 "
                    "冰蜂蜜奶茶-大 熱蜂蜜奶茶-中 焦糖冰奶茶-大 冰奶茶-大 可口可樂-中 可口可樂Zero-中 雪碧-中 "
                    "冰紅茶檸檬風味-中 無糖冰紅茶-中 無糖冰綠茶-中 麥克雞塊-4塊 麥克雞塊-6塊 麥克雞塊-10塊 "
                    "薯條-大 玉米濃湯-大 OREO冰炫風 雙倍OREO冰炫風").split(),
            "get": ("可口可樂-中 可口可樂Zero-中 雪碧-中 冰紅茶檸檬風味-中 無糖冰紅茶-中 無糖冰綠茶-中 "
                    "經典美式咖啡-熱-中 經典美式咖啡-冰-中 熱紅茶-中 熱奶茶-中 薯餅 蛋捲冰淇淋 薯條-小").split(),
            "start": "2026-03-18", "end": "2027-03-31",
            "note": "2026 年版每包 39 元，期限內不限次數。薯餅限早餐、小薯 10:30 後。",
            "source": "售價與期限：cashfeel《麥當勞甜心卡怎麼買》；A/B 品項" + VIA_SUSUGO,
            "asOf": None,
            "verified": False,
        },
        combo("breakfast-hash-brown", "早餐套餐 薯餅配餐", [g(BREAKFAST), g(DRINK38), g("薯餅")],
              discount=30, note="早餐主餐 + 中杯 $38 飲料 + 薯餅（折 $30）；早餐時段"),
        combo("breakfast-nuggets", "早餐套餐 鷄塊配餐",
              [g(BREAKFAST[:-1]), g(DRINK38), g("麥克雞塊-4塊")],
              discount=21, note="早餐主餐 + 中杯 $38 飲料 + 4 塊麥克鷄塊（折 $21）；早餐時段"),
        combo("breakfast-americano", "早餐套餐 美式咖啡配餐",
              [g(BREAKFAST), g(["經典美式咖啡-熱-中", "經典美式咖啡-冰-中"])],
              discount=15, note="早餐主餐 + 經典美式咖啡（折 $15）；早餐時段"),
        combo("breakfast-drink", "早餐套餐 飲料配餐", [g(BREAKFAST), g(DRINK38)],
              discount=13, note="早餐主餐 + 中杯 $38 飲料（折 $13）；早餐時段"),
        combo("breakfast-avocado", "早餐套餐 薯餅配餐（酪梨醬滿福系列）",
              [g(AVOCADO), g(DRINK38), g("薯餅")], discount=30,
              start="2026-11-04", end="2026-12-15",
              note="酪梨醬滿福系列 + 中杯 $38 飲料 + 薯餅（折 $30）"),
        combo("truffle-combo", "松露黑堡 經典套餐", [g(TRUFFLE), g(DRINK38), g(fries_m)],
              discount=18, start=halloween[0], end=halloween[1],
              note="松露黑堡系列 + 中杯 $38 飲料 + 中薯（折 $18）"),
        combo("truffle-share-box", "金薯松露黑堡分享盒",
              [g(GOLD_TRUFFLE, 2), g(n10, 2), g(fries_l)], price=450,
              start=halloween[0], end=halloween[1], note="金薯松露黑堡 2 份 + 20 塊麥克鷄塊 + 大薯"),
        combo("halloween-ice", "冰酷萬聖黑特餐",
              [g(GOLD_TRUFFLE), g(seaweed), g("黑森林冰炫風"), g(DRINK38)], price=270,
              start=halloween[0], end=halloween[1]),
        combo("halloween-pie", "甜派萬聖黑特餐",
              [g(GOLD_TRUFFLE), g(seaweed), g("巧克力三角派"), g(DRINK38)], price=250,
              start=halloween[0], end=halloween[1]),
        combo("share-nuggets-20-seaweed", "麥克鷄塊分享盒 20 塊（海苔搖搖薯條）",
              [g(n10, 2), g(seaweed)], price=223, start=halloween[0], end=halloween[1]),
        combo("share-nuggets-30-seaweed", "麥克鷄塊分享盒 30 塊（海苔搖搖薯條）",
              [g(n10, 3), g(seaweed)], price=316, start=halloween[0], end=halloween[1]),
        combo("share-wings-seaweed", "勁辣香鷄翅分享盒（海苔搖搖薯條）",
              [g("勁辣香雞翅", 6), g(seaweed)], price=267, start=halloween[0], end=halloween[1]),
        combo("share-nuggets-20", "麥克鷄塊分享盒 20 塊", [g(n10, 2), g(fries_l)], price=220),
        combo("share-nuggets-30", "麥克鷄塊分享盒 30 塊", [g(n10, 3), g(fries_l)], price=313),
        combo("share-wings", "勁辣香鷄翅分享盒", [g("勁辣香雞翅", 6), g(fries_l)], price=264),
        combo("share-crispy", "麥脆鷄腿分享盒", [g("麥脆雞腿-2塊", 3), g(fries_l, 2)], price=453),
        combo("share-nuggets-crispy", "鷄塊鷄腿分享盒",
              [g(n10), g("麥脆雞腿-2塊", 3), g(fries_l, 2)], price=546),
        combo("line-gold-americano-3for3", "金選美式買 3 送 3（LINE 隨買店取）",
              [g(["金選美式-熱-中", "金選美式-冰-中"], 6)], price=180,
              start="2026-11-09", end="2026-11-22",
              note="付 3 杯的錢拿 6 杯；需在 LINE 隨買店取購買", source=LINE_SRC, as_of="2026-11-11"),
        combo("line-caramel-6for2", "焦糖冰奶茶買 6 送 2（LINE 隨買店取）",
              [g("焦糖冰奶茶-大", 8)], price=408, start="2026-11-09", end="2026-11-22",
              note="付 6 杯的錢拿 8 杯；需在 LINE 隨買店取購買", source=LINE_SRC, as_of="2026-11-11"),
        combo("anniv-wings-bogo", "APP 週年慶 勁辣香鷄翅買一送一",
              [g("勁辣香雞翅", 2)], price=49, start="2026-11-04", end="2026-11-17",
              note="週年慶優惠券每週換品項，實際以 APP 為準", source=APP_SRC, as_of="2026-11-11"),
        combo("anniv-hashbrown-bogo", "APP 週年慶 薯餅買一送一",
              [g("薯餅", 2)], price=37, start="2026-11-04", end="2026-11-17",
              note="週年慶優惠券每週換品項，實際以 APP 為準", source=APP_SRC, as_of="2026-11-11"),
        combo("anniv-meal-fries", "APP 週年慶 買超值全餐送中薯",
              [g(MAINS), g(DRINK38), g(fries_m), g(fries_m)], discount=18 + 50,
              start="2026-11-04", end="2026-11-17",
              note="以 A 經典配餐估算再多送一份中薯；實際券面以 APP 為準",
              source=APP_SRC, as_of="2026-11-11"),
    ]


PTT_SRC = "PTT fastfood〈麥當勞點數回饋率計算〉（2024-09-23）"
PTT_ASOF = "2024-09-23"
MEAL_NUGGETS6 = ["麥克雞塊-6塊", "薯條-中", "可口可樂-中"]

# (名稱補充, 品項, 點數, 加付現金)；點數是 2024-09 的資料，現在可能已調整
MPOINT_TABLE = [
    ("", ["蛋捲冰淇淋"], 300, 0),
    ("可樂／Zero／雪碧擇一", ["可口可樂-小"], 300, 0),
    ("冰無糖紅／綠茶擇一", ["無糖冰紅茶-小"], 360, 0),
    ("", ["薯餅"], 800, 0),
    ("", ["薯條-小"], 800, 0),
    ("", ["蘋果派"], 1200, 0),
    ("冰／熱擇一", ["經典美式咖啡-熱-中"], 1200, 0),
    ("", ["麥克雞塊-4塊"], 1500, 0),
    ("", ["吉事漢堡"], 2000, 0),
    ("", ["豬肉滿福堡"], 2000, 0),
    ("", ["勁辣香雞翅"], 2000, 0),
    ("", ["冰蜂蜜紅茶-大"], 2000, 0),
    ("", ["焦糖冰奶茶-大"], 2000, 0),
    ("冰／熱擇一", ["經典那堤-熱-中"], 2000, 0),
    ("", ["大麥克"], 2700, 0),
    ("", ["勁辣雞腿堡"], 2700, 0),
    ("", ["四盎司牛肉堡"], 2700, 0),
    ("6 塊鷄塊套餐：中薯＋中可", MEAL_NUGGETS6, 2800, 0),
]

# 點點卡現行兌換表：官網兌換頁的圖上直接印點數（圖檔 2026-05-27 版，11/18 查）。
# 2026 年中起點數調高、套餐和「點數＋現金」都拿掉了，只剩這 8 樣純點數兌換。
DOTCARD_SRC = "麥當勞官網點點卡兌換商品頁（圖檔 2026-05-27 版，2026-11-18 查）"
DOTCARD_ASOF = "2026-11-18"
DOTCARD_TABLE = [
    ("", ["蛋捲冰淇淋"], 25, 0),
    ("", ["薯餅"], 45, 0),
    ("", ["滿福堡"], 55, 0),
    ("", ["麥克雞塊-4塊"], 55, 0),
    ("", ["OREO冰炫風"], 70, 0),
    ("", ["薯條-大"], 70, 0),
    ("", ["勁辣雞腿堡"], 90, 0),
    ("", ["大麥克"], 90, 0),
]


def lines_of(ids):
    counts = {}
    for i in ids:
        counts[i] = counts.get(i, 0) + 1
    return [{"id": i, "qty": q} if q > 1 else {"id": i} for i, q in counts.items()]


def build_redemptions():
    out = []
    for currency, prefix, table, src, as_of in [
        ("mpoint", "mp", MPOINT_TABLE, PTT_SRC, PTT_ASOF),
        ("dotcard", "dc", DOTCARD_TABLE, DOTCARD_SRC, DOTCARD_ASOF),
    ]:
        for n, (label, ids, pts, cash) in enumerate(table, 1):
            r = {"id": f"{prefix}-{n:02d}", "currency": currency, "points": pts,
                 "items": lines_of(ids)}
            if cash:
                r["cash"] = cash
            if label:
                r["label"] = label
            r.update(start=None, end=None, source=src, asOf=as_of, verified=False)
            out.append(r)
    return out


def build():
    data = {
        "meta": {
            "note": "每筆的 asOf 是那份資料本身的日期，不是抓取日；null 代表來源沒寫日期。"
                    "verified 改成 true 代表已在 APP 或門市親自確認。",
        },
        "currencies": [
            {"id": "mpoint", "name": "M Point", "earnPerDollar": 1,
             "note": "APP 會員消費 1 元累積 1 點，在 APP「M Point 樂園」兌換；效期到次年同月底。",
             "source": PTT_SRC + "；符碼記憶《麥當勞攻略》（2026-03-19）", "asOf": PTT_ASOF,
             "verified": False},
            {"id": "dotcard", "name": "點點卡", "earnPerDollar": 0.1,
             "note": "消費 10 元積 1 點（未滿 10 元不計）。只能在櫃台或官方 LINE「點數商城」兌換，"
                     "自助點餐機不行；不可加價、不可和其他優惠併用。2026 年中起兌換點數調高、"
                     "套餐下架。和 M Point 各自獨立，同一筆消費可兩邊一起累積。"
                     "2025 年度點數效期到 2027-03-31。",
             "source": DOTCARD_SRC + "；Heresy's Space〈麥當勞點點卡回饋縮水〉（2026-07-04）；"
                       "符碼記憶《麥當勞攻略》（2026-03-19）",
             "asOf": DOTCARD_ASOF, "verified": False},
        ],
        "items": build_items(),
        "deals": build_deals(),
        "redemptions": build_redemptions(),
        "promos": [{
            "id": "anniv-mpoint-2026", "name": "APP 週年慶 M Point 兌換 6 折起",
            "currency": "mpoint", "start": "2026-11-18", "end": "2026-11-24",
            "rules": [{"items": ["勁辣雞腿堡", "麥克雞塊-10塊"], "multiplier": 0.6},
                      {"multiplier": 0.8}],
            # 官方寫「其他適用單點 8 折」，套餐類兌換不算
            "excludeRedemptions": ["mp-18"],
            "note": "勁辣鷄腿堡、10 塊麥克鷄塊 6 折，其他適用單點 8 折；實際點數以 APP 為準。",
            "source": APP_SRC, "asOf": "2026-11-18", "verified": False,
        }],
    }
    out = Path(__file__).resolve().parent.parent / "public" / "data" / "offers.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"items={len(data['items'])} deals={len(data['deals'])} "
          f"redemptions={len(data['redemptions'])}")


if __name__ == "__main__":
    build()
