#!/usr/bin/env python3
"""反馈快照提取：把玩家反馈里的存档快照导出为可直接导入游戏的存档文件。

用法：
  python3 tools/fb_extract.py                          # 解析 feedback/ 下全部 JSONL
  python3 tools/fb_extract.py feedback/feedback-202510.jsonl
  python3 tools/fb_extract.py --id p-1a2b              # 按 pid / 昵称 / 正文子串过滤
  python3 tools/fb_extract.py --out replays            # 导出目录（默认 feedback/replays/）
  python3 tools/fb_extract.py --server http://1.2.3.4:8613 --token 秘密token
                                                       # 额外打印「点开即复盘」链接（?load= 快照地址）

输出：
  1) 台账：时间 | pid | 版本 | 分类 | 进度 | 快照 | 闭环 | 正文摘要（+ 复盘链接）
  2) 每条含快照的反馈 → <out>/<时间>-<pid>-<天数>d.json，
     游戏内「📂 存档管理 → ⬆️ 导入存档文件」即可精确复盘该玩家当时的局面；
     带 --server/--token 时直接打开打印的链接即可在线加载。
仅读取本机文件，不联网；快照只含游戏数据。
闭环清单：服务器上维护 feedback/FIXED.md（格式见 tools/FIXED.md），出现的反馈 id 视为已处理。
"""
import argparse
import json
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FB = ROOT / 'feedback'


def iter_entries(paths):
    """展开目录/文件，逐行产出 (来源, 行号, 条目)。"""
    for p in paths:
        if p.is_dir():
            files = sorted(p.glob('feedback-*.jsonl'))
            if not files:
                print(f'（{p} 下没有 feedback-*.jsonl）', file=sys.stderr)
            yield from iter_entries(files)
            continue
        if not p.exists():
            print(f'（跳过不存在的 {p}）', file=sys.stderr)
            continue
        with p.open('r', encoding='utf-8') as f:
            for ln, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    yield p, ln, json.loads(line)
                except json.JSONDecodeError as e:
                    print(f'（跳过坏行 {p}:{ln}：{e}）', file=sys.stderr)


def fmt_time(ts):
    try:
        return time.strftime('%m-%d %H:%M', time.localtime(ts / 1000 if ts > 1e11 else ts))
    except Exception:
        return '?'


def prog_str(e):
    p = e.get('progress') or {}
    if not p:
        return '?'
    return f"{p.get('year', '?')}年{p.get('season', '?')}d{p.get('day', '?')} 人口{p.get('pop', '?')}"


def load_fixed_ids(paths):
    """读闭环清单（feedback/FIXED.md 优先，退回 tools/FIXED.md），返回已处理反馈 id 集合。"""
    import re
    ids = set()
    for cand in [Path(p).parent / 'FIXED.md' if not Path(p).is_dir() else Path(p) / 'FIXED.md' for p in paths] + \
                [DEFAULT_FB / 'FIXED.md', ROOT / 'tools' / 'FIXED.md']:
        try:
            if cand.is_file():
                ids.update(re.findall(r'f[0-9a-f]{10}', cand.read_text(encoding='utf-8')))
                break
        except OSError:
            continue
    return ids


def main():
    ap = argparse.ArgumentParser(description='反馈快照提取 → 可导入游戏的存档文件')
    ap.add_argument('paths', nargs='*', default=[str(DEFAULT_FB)], help='feedback JSONL 文件或目录')
    ap.add_argument('--id', dest='fid', default='', help='按 pid/昵称/正文子串过滤')
    ap.add_argument('--out', default=str(DEFAULT_FB / 'replays'), help='快照导出目录')
    ap.add_argument('--server', default='', help='服务器地址（如 http://1.2.3.4:8613），用于打印一键复盘链接')
    ap.add_argument('--token', default='', help='查看反馈的 token（配合 --server）')
    args = ap.parse_args()

    paths = [Path(x) for x in args.paths]
    out = Path(args.out)
    fixed_ids = load_fixed_ids(paths)
    rows = []
    for src, ln, e in iter_entries(paths):
        blob = json.dumps(e, ensure_ascii=False)
        if args.fid and args.fid not in blob:
            continue
        rows.append((src, ln, e))
    if not rows:
        print('没有匹配的反馈。', file=sys.stderr)
        return 1
    rows.sort(key=lambda r: r[2].get('t') or r[2].get('recv') or 0)

    print(f'共 {len(rows)} 条反馈（按时间排序）\n')
    print(f"{'#':>3}  {'时间':<11}  {'pid':<10}  {'版本':<7} {'分类':<5} {'进度':<16} 快照 闭环 正文")
    exported = []
    for i, (src, ln, e) in enumerate(rows, 1):
        ts = e.get('t') or e.get('recv') or 0
        pid = (e.get('pid') or '?')[:10]
        ver = e.get('v') or '旧版'
        tag = e.get('tag') or '—'
        text = (e.get('text') or '').replace('\n', ' ')[:40]
        has_save = bool(e.get('save'))
        done = '✓' if e.get('id') in fixed_ids else '待处理'
        print(f'{i:>3}  {fmt_time(ts):<11}  {pid:<10}  {ver:<7} {tag:<5} {prog_str(e):<16} {"✓" if has_save else "—"}   {done}  {text}')
        if args.server and e.get('id') and has_save:
            print(f"      ↳ 复盘链接: {args.server}/api/feedback/{e['id']}/replay?token={urllib.parse.quote(args.token, safe='')}")
        if has_save:
            save = dict(e['save'])
            save.setdefault('savedAt', ts or time.time() * 1000)
            day = (e.get('progress') or {}).get('day', 0)
            name = f"{time.strftime('%Y%m%d-%H%M%S', time.localtime((ts or time.time()*1000) / 1000))}-{pid}-{day}d.json"
            out.mkdir(parents=True, exist_ok=True)
            fp = out / name
            fp.write_text(json.dumps(save, ensure_ascii=False), encoding='utf-8')
            exported.append(fp)

    print(f'\n已导出 {len(exported)} 个可复盘存档 → {out}/')
    if exported:
        print('复盘：游戏内 📂 存档管理 → ⬆️ 导入存档文件，选择上面的 json 即可回到该玩家反馈时的精确局面。')
    else:
        print('（这些反馈都没有附带存档快照）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
