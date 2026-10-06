#!/usr/bin/env python3
# 切图脚本：把 art/ 下的整张 AI 生成精灵图切成 assets/ 里的单件 PNG（供 js/sprites.js 加载）。
# 用法：python3 tools/slice_assets.py   （依赖：pip3 install pillow scipy numpy）
# 来源图：
#   art/sheet-1-main.png    地表/植被岩石/建筑/作物/人物/图标 大合集
#   art/sheet-2-missing.png 补充：石屋/宿舍/矿井 + 无雪松树三阶段
# 处理：alpha 归一化（AI 导出常卡在 250-254）、剔除图内烘焙的文字标签与红色栏目标题、
#       每个精灵取窗口内最大连通域（顺带丢弃两栋建筑之间的游离装饰碎片）。
import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')


def load(name):
    return np.array(Image.open(os.path.join(ROOT, 'art', name)).convert('RGBA'))


def norm_alpha(arr):
    a = arr[..., 3].astype(np.float32)
    arr[..., 3] = np.minimum(255.0, a * (255.0 / 250.0)).astype(np.uint8)
    return arr


def punch_red_titles(arr, rects):
    """红色栏目标题（建筑/图标 等）只出现在已知区域，按暗红色特征清除。"""
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    red = (arr[..., 3] > 12) & (r > 35) & (r > 1.4 * g + 5) & (r > 1.4 * b + 5)
    for (x0, y0, x1, y1) in rects:
        sub = red[y0:y1, x0:x1]
        arr[y0:y1, x0:x1, 3][sub] = 0
    return arr


def punch_label_rects(arr, rects):
    """和精灵像素粘连、组件级剔除无效的文字标签（逐个定位后硬清除）。"""
    for (x0, y0, x1, y1) in rects:
        arr[y0:y1, x0:x1, 3] = 0
    return arr


def punch_text(arr):
    """烘焙的灰色小标签：矮、宽、像素少、低饱和深色 → 整块清除。"""
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    opa = arr[..., 3] > 12
    lowsat = (np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)) < 45
    dark = (r + g + b) / 3 < 150
    cand = opa & lowsat & dark
    lab, n = ndimage.label(cand)
    removed = 0
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        h = ys.max() - ys.min() + 1
        w = xs.max() - xs.min() + 1
        if h <= 22 and len(ys) < 1500 and w / h >= 1.8:
            arr[ys, xs, 3] = 0
            removed += 1
    print('  text labels removed:', removed)
    return arr


def largest_comp_box(arr, x0, y0, x1, y1, min_px=60):
    """窗口内最大连通域的紧致包围盒（全图坐标）。"""
    win = arr[y0:y1, x0:x1]
    mask = win[..., 3] > 12
    if not mask.any():
        return None
    lab, n = ndimage.label(mask)
    best, best_px = None, 0
    for i in range(1, n + 1):
        px = int((lab == i).sum())
        if px > best_px:
            best, best_px = i, px
    if best is None or best_px < min_px:
        return None
    ys, xs = np.where(lab == best)
    return (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)


def union_box(arr, x0, y0, x1, y1):
    win = arr[y0:y1, x0:x1]
    mask = win[..., 3] > 12
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    return (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)


def cut(arr, box, pad=1):
    x0, y0, x1, y1 = box
    h, w = arr.shape[:2]
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad); x1 = min(w, x1 + pad); y1 = min(h, y1 + pad)
    return arr[y0:y1, x0:x1]


def save(arr, rel):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr).save(path, optimize=True)


def despeckle_red(arr, max_px=36):
    """AI 生成常见的游离饱和红点杂讯。"""
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    red = (arr[..., 3] > 12) & (r > 170) & (g < 75) & (b < 75)
    lab, n = ndimage.label(red)
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) <= max_px:
            arr[ys, xs, 3] = 0
    return arr


def main():
    s1 = norm_alpha(load('sheet-1-main.png'))
    s2 = despeckle_red(norm_alpha(load('sheet-2-missing.png')))
    n = 0

    # 红色标题只在下面这些已知区域出现
    s1 = punch_red_titles(s1, [(10, 3, 250, 42), (585, 145, 750, 192), (10, 315, 92, 366),
                               (10, 838, 145, 885), (400, 838, 525, 888), (1108, 838, 1235, 895)])
    # 与精灵粘连的标签（"house" 文字贴着木屋栅栏）
    s1 = punch_label_rects(s1, [(86, 585, 121, 600)])
    print('sheet1:')
    s1 = punch_text(s1)

    # ---------- 地表纹理：规则网格行（正方形可平铺），并集框即可 ----------
    tiles_row1 = ['grass_spring', 'grass_summer', 'grass_autumn', 'grass_winter',
                  'sand_spring', 'sand_summer', 'sand_autumn', 'sand_winter',
                  'water_spring', 'water_summer', 'water_summer_b', 'water_autumn', 'water_winter']
    cells1 = [(20, 100), (112, 193), (204, 288), (296, 377), (387, 467), (477, 558), (566, 649),
              (659, 741), (752, 835), (844, 930), (940, 1029), (1039, 1126), (1137, 1223)]
    for name, (x0, x1) in zip(tiles_row1, cells1):
        save(cut(s1, union_box(s1, x0, 36, x1, 127), pad=0), f'tiles/{name}.png'); n += 1
    tiles_row2 = ['road_spring', 'road_summer', 'road_autumn', 'road_winter', 'farm_soil', 'farm_soil_snow']
    cells2 = [(19, 100), (112, 193), (205, 287), (297, 380), (390, 479), (489, 575)]
    for name, (x0, x1) in zip(tiles_row2, cells2):
        save(cut(s1, union_box(s1, x0, 150, x1, 248), pad=0), f'tiles/{name}.png'); n += 1

    # ---------- 其余单件：窗口内最大连通域 ----------
    singles1 = {
        # 植被与岩石
        'props/tree_sapling.png':      (595, 225, 665, 302),
        'props/tree_young.png':        (650, 185, 742, 302),
        'props/tree_mature.png':       (738, 158, 862, 302),
        'props/tree_sapling_snow.png': (852, 226, 912, 302),
        'props/tree_young_snow.png':   (906, 186, 988, 302),
        'props/tree_mature_snow.png':  (980, 158, 1082, 302),
        'props/rock_a.png':            (1070, 215, 1155, 305),
        'props/rock_b.png':            (1150, 210, 1244, 305),
        'props/rock_a_snow.png':       (1244, 205, 1336, 305),
        'props/rock_b_snow.png':       (1332, 205, 1440, 305),
        # 建筑
        'buildings/house.png':      (8, 300, 362, 625),
        'buildings/storage.png':    (296, 328, 606, 622),
        'buildings/gatherer.png':   (595, 345, 865, 605),
        'buildings/forester.png':   (860, 355, 1150, 605),
        'buildings/woodcutter.png': (1130, 345, 1444, 640),
        'buildings/dock.png':       (8, 590, 404, 845),
        'buildings/school.png':     (404, 530, 712, 840),
        'buildings/site_2x2.png':   (700, 600, 1000, 835),
        'buildings/site_3x3.png':   (990, 570, 1435, 840),
        # 农田作物（自带土堆底座）
        'props/crop_stage0.png': (8, 884, 82, 1046),
        'props/crop_stage1.png': (82, 884, 150, 1046),
        'props/crop_stage2.png': (150, 884, 225, 1046),
        'props/crop_ripe.png':   (225, 884, 303, 1046),
        'props/crop_dead.png':   (303, 884, 395, 1046),
        # 人物（成人）
        'citizens/adult_walk_0.png':       (413, 870, 467, 949),
        'citizens/adult_walk_1.png':       (471, 870, 524, 949),
        'citizens/adult_walk_2.png':       (525, 870, 578, 949),
        'citizens/adult_walk_3.png':       (577, 870, 632, 949),
        'citizens/adult_work_0.png':       (637, 870, 700, 949),
        'citizens/adult_work_1.png':       (700, 870, 762, 949),
        'citizens/adult_carry_walk_0.png': (763, 868, 819, 952),
        'citizens/adult_carry_walk_1.png': (820, 868, 876, 952),
        'citizens/adult_carry_walk_2.png': (877, 868, 931, 952),
        'citizens/adult_carry_walk_3.png': (933, 868, 992, 952),
        'citizens/adult_idle.png':         (990, 868, 1042, 952),
        'citizens/adult_carry_idle.png':   (1043, 868, 1098, 952),
        # 人物（儿童）
        'citizens/child_walk_0.png': (407, 978, 461, 1051),
        'citizens/child_walk_1.png': (463, 978, 519, 1051),
        'citizens/child_walk_2.png': (517, 978, 569, 1051),
        'citizens/child_walk_3.png': (573, 978, 620, 1051),
        'citizens/child_idle.png':   (636, 978, 680, 1051),
        # 搬运物（虚线框内）
        'citizens/carry_wood.png':     (710, 978, 800, 1048),
        'citizens/carry_stone.png':    (803, 978, 884, 1048),
        'citizens/carry_food.png':     (886, 978, 958, 1048),
        'citizens/carry_firewood.png': (958, 978, 1049, 1048),
        # 图标
        'icons/res_wood.png':        (1114, 844, 1182, 924),
        'icons/res_stone.png':       (1186, 844, 1248, 924),
        'icons/res_food.png':        (1248, 844, 1308, 924),
        'icons/res_firewood.png':    (1308, 844, 1376, 924),
        'icons/tool_house.png':      (1376, 844, 1440, 924),
        'icons/tool_storage.png':    (1114, 930, 1180, 1010),
        'icons/tool_gatherer.png':   (1180, 930, 1244, 1010),
        'icons/tool_forester.png':   (1244, 930, 1308, 1010),
        'icons/tool_woodcutter.png': (1310, 930, 1376, 1010),
        'icons/tool_dock.png':       (1378, 930, 1436, 1010),
        'icons/tool_school.png':     (1114, 1008, 1180, 1056),
        'icons/tool_farm.png':       (1180, 1002, 1240, 1076),
        'icons/tool_road.png':       (1240, 1008, 1310, 1056),
        'icons/tool_demolish.png':   (1310, 1002, 1376, 1058),
        'icons/alert.png':           (1378, 1002, 1436, 1058),
    }
    for rel, (x0, y0, x1, y1) in singles1.items():
        box = largest_comp_box(s1, x0, y0, x1, y1)
        if box is None:
            print('!! 未找到内容:', rel)
            continue
        save(cut(s1, box), rel); n += 1

    # ---------- 补充图（无标签）：最大连通域 ----------
    print('sheet2:')
    for rel, (x0, y0, x1, y1) in {
        'buildings/stonehouse.png': (0, 0, 660, 600),
        'buildings/boarding.png':   (662, 0, 1458, 724),
        'buildings/mine.png':       (1450, 0, 2171, 600),
        'props/tree_sapling.png':   (660, 460, 890, 724),
        'props/tree_young.png':     (975, 455, 1195, 724),
        'props/tree_mature.png':    (1235, 360, 1545, 724),
    }.items():
        box = largest_comp_box(s2, x0, y0, x1, y1, min_px=500)
        if box is None:
            print('!! 未找到内容:', rel)
            continue
        save(cut(s2, box), rel); n += 1

    print('共输出', n, '个文件 →', OUT)


if __name__ == '__main__':
    main()
