#!/usr/bin/env python3
"""反馈聚合分析：把 feedback/*.jsonl 汇总成一份 markdown 报告。

用法：
  python3 tools/fb_stats.py                        # 解析 feedback/ 下全部 JSONL
  python3 tools/fb_stats.py feedback/*.jsonl --out 报告.md

报告内容：反馈量/版本分布、玩家进度直方图、死因合计、资源水位（按 pid 取最新快照
避免同一玩家多条反馈重复计数）、饥荒深度（滚动日志 60 天内 食物/人口 最低谷）、
关键词频次、脚本错误样本。只读本机文件，不联网。
"""
import argparse
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FB = ROOT / 'feedback'
EAT_PER_DAY = 2.083  # 与 G.LIFE.eatPerDay 保持一致（100 食物/48 天）

KEYWORDS = ['难', '简单', '饿', '冻', '食物', '柴火', '木材', '石头', '铁', '房屋', '宿舍',
            '农田', '采集', '护林', '伐木', '渔', '死亡', '人口', '孩子', '学校', '学堂',
            '慢', '快', '卡', 'bug', '崩', '闪退', '多', '少']


def iter_entries(paths):
    for p in paths:
        if p.is_dir():
            yield from iter_entries(sorted(p.glob('feedback-*.jsonl')))
            continue
        if not p.exists():
            continue
        with p.open('r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def hist_min_food_days(e):
    """滚动日志里 食物/人口 的最低谷（换算成可撑天数）。"""
    hist = e.get('hist') or []
    worst = None
    for h in hist:
        pop = h.get('pop') or 0
        if pop <= 0:
            continue
        days = h.get('food', 0) / (pop * EAT_PER_DAY)
        if worst is None or days < worst:
            worst = days
    return worst


def bucket(v, edges, labels):
    for i, edge in enumerate(edges):
        if v < edge:
            return labels[i]
    return labels[-1]


def load_fixed_ids(paths):
    """闭环清单：传入目录下的 FIXED.md → feedback/FIXED.md（服务器）→ tools/FIXED.md（仓库模板）。"""
    import re
    ids = set()
    cands = [(p.parent / 'FIXED.md') if p.suffix == '.jsonl' else (p / 'FIXED.md') for p in paths]
    cands += [DEFAULT_FB / 'FIXED.md', ROOT / 'tools' / 'FIXED.md']
    for cand in cands:
        try:
            if cand.is_file():
                ids.update(re.findall(r'f[0-9a-f]{10}', cand.read_text(encoding='utf-8')))
                break
        except OSError:
            continue
    return ids


def main():
    ap = argparse.ArgumentParser(description='反馈聚合分析 → markdown 报告')
    ap.add_argument('paths', nargs='*', default=[str(DEFAULT_FB)], help='feedback JSONL 文件或目录')
    ap.add_argument('--out', default='', help='写入文件（默认打印到终端）')
    args = ap.parse_args()

    paths = [Path(x) for x in args.paths]
    entries = list(iter_entries(paths))
    if not entries:
        print('没有可分析的反馈。', file=sys.stderr)
        return 1

    ts = [e.get('t') or e.get('recv') or 0 for e in entries]
    span = f"{time.strftime('%Y-%m-%d', time.localtime(min(ts) / 1000))} ~ {time.strftime('%Y-%m-%d', time.localtime(max(ts) / 1000))}"
    pids = Counter(e.get('pid') or '?' for e in entries)
    versions = Counter(e.get('v') or '未知(旧版)' for e in entries)

    # 同一玩家只取最新一条做快照统计，避免多条反馈重复计数
    latest = {}
    for e in entries:
        pid = e.get('pid') or '?'
        if pid not in latest or (e.get('t') or 0) > (latest[pid].get('t') or 0):
            latest[pid] = e
    snaps = [e for e in latest.values() if isinstance(e.get('save'), dict)]

    lines = ['# 反馈分析报告', '']
    lines.append(f'- 反馈 **{len(entries)}** 条 · 玩家 **{len(pids)}** 人 · 时间跨度 {span}')
    lines.append(f'- 版本分布：' + '，'.join(f'{k} ×{v}' for k, v in versions.most_common()))

    # 分类标签与闭环率
    tags = Counter(e.get('tag') or '未分类' for e in entries)
    lines.append(f'- 分类：' + '，'.join(f'{k} ×{v}' for k, v in tags.most_common()))
    fixed_ids = load_fixed_ids(paths)
    with_id = [e for e in entries if e.get('id')]
    done = sum(1 for e in with_id if e['id'] in fixed_ids)
    lines.append(f'- 闭环：{done}/{len(with_id)} 已处理（清单 feedback/FIXED.md）；待处理 {len(with_id) - done} 条')
    pending = [e for e in sorted(with_id, key=lambda x: x.get('t') or 0) if e['id'] not in fixed_ids]
    for e in pending[-8:]:
        lines.append(f"  - 待处理 `{e['id']}` ({(e.get('pid') or '?')}, v{e.get('v') or '?'}, {(e.get('tag') or '未分类')}) {(e.get('text') or '')[:40]}")

    # 进度直方图（全部反馈的 progress）
    day_edges, day_labels = [12, 24, 36, 48, 96, 10 ** 9], ['第1季', '第2季', '第3季', '第1年内', '1-2年', '2年+']
    day_hist = Counter(bucket((e.get('progress') or {}).get('day', 0), day_edges, day_labels) for e in entries)
    lines.append(f'- 进度分布：' + '，'.join(f'{k} ×{v}' for k, v in day_hist.most_common()))
    pops = [(e.get('progress') or {}).get('pop') for e in entries if (e.get('progress') or {}).get('pop') is not None]
    if pops:
        lines.append(f'- 反馈时人口：中位 {statistics.median(pops):.0f} · 最大 {max(pops)}')

    # 快照聚合（每玩家最新一条）
    if snaps:
        death_sum = Counter()
        btypes = Counter()
        for e in snaps:
            g = (e['save'].get('game') or {})
            for k, v in ((g.get('stats') or {}).get('deadReasons') or {}).items():
                death_sum[k] += v
            for b in e['save'].get('buildings') or []:
                btypes[b.get('type') or '?'] += 1
        if death_sum:
            lines.append(f'- 死因合计（{len(snaps)} 名玩家快照）：' + '，'.join(f'{k} ×{v}' for k, v in death_sum.most_common()))
        else:
            lines.append(f'- 死因合计：快照中无死亡记录')
        if btypes:
            top = '，'.join(f'{k} ×{v}' for k, v in btypes.most_common(8))
            lines.append(f'- 建筑拥有量（快照合计）：{top}')
        # 饥荒深度（滚动日志）
        famines = [hist_min_food_days(e) for e in snaps if hist_min_food_days(e) is not None]
        if famines:
            f_edges, f_labels = [1, 3, 8, 10 ** 9], ['断粮(<1天)', '危急(<3天)', '紧张(<8天)', '健康(≥8天)']
            f_hist = Counter(bucket(v, f_edges, f_labels) for v in famines)
            lines.append(f'- 60 天内食物最低谷（可撑天数）：' + '，'.join(f'{k} ×{v}人' for k, v in f_hist.most_common()))

    # 关键词
    kw = Counter()
    for e in entries:
        text = (e.get('text') or '').lower()
        for k in KEYWORDS:
            if k in text:
                kw[k] += 1
    if kw:
        lines.append(f'- 关键词：' + '，'.join(f'{k}×{v}' for k, v in kw.most_common(10)))

    # 脚本错误
    errs = [e for e in entries if e.get('errs')]
    lines.append(f'- 携带脚本错误的反馈：{len(errs)} 条')
    for e in errs[:3]:
        lines.append(f'  - `{(e["errs"][0] or "")[:120]}`')

    report = '\n'.join(lines) + '\n'
    if args.out:
        Path(args.out).write_text(report, encoding='utf-8')
        print(f'报告已写入 {args.out}')
    else:
        print(report)
    return 0


if __name__ == '__main__':
    sys.exit(main())
