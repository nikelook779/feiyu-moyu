#!/usr/bin/env python
"""抠图：把纯白背景的角色图转为透明 PNG。
用 `python cutout.py` 重新生成 assets/p_*.png。

三个关键步骤（每个都踩过坑，勿删）：
1. 背景色用「最亮 5% 像素的中位数」估计，不能用四角中位数 —— 裁剪后四角可能撞到人物，
   导致 bg 取错、整张图抠不掉。
2. 阈值必须 18~20。阈值 40 会把白毛衣、浅色皮肤一起吃掉（肥鱼曾只剩头发和脸）。
   验证法：看 d 的分位数，纯白背景下背景 d≈0，阈值取在 15~20 之间。
3. 后处理两步：
   a. clean_edge_white —— 透明化贴近左右边缘的浅色背景（AI 生成图常有淡渐变残留）。
      注意它必须**返回**新 mask；写成原地改副本会静默失效。
   b. 连通域过滤 —— 丢弃小于主块 5% 的孤立块。**不能用"只保留最大块"**：
      显示器和人物在像素上不连通，会把显示器一起删掉。
"""
from PIL import Image, ImageFilter
import numpy as np
from collections import deque


def components(mask, min_size=120):
    H, W = mask.shape
    seen = np.zeros_like(mask, bool)
    out = []
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                if len(pts) >= min_size: out.append(pts)
    return out


def clean_edge_white(arr, rgb, frac=0.30):
    """透明化「从画面边缘连通进去」的浅色背景。

    ⚠ 早期版本用矩形一刀切（把左右各 18% 里的近白像素全删），
      结果把老板文件夹里的**白纸**、白衬衫一起删了 —— 视觉上就是"透明破洞"。
      现在改成洪水填充：只从四条边的种子点出发，漫延到的近白像素才算背景。
      主体被深色描边围住的白色（文件夹纸、衬衫、马甲）不会被波及。
    """
    H, W = arr.shape
    a = rgb.astype(int); r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    lum = (r + g + b) / 3
    # 背景是**纯白** (255,255,255)；主体里的白（毛衣/文件纸/衬衫）都带暖偏色或更暗。
    # 例：肥鱼毛衣 (252,241,233) g-b 差 8、亮度差 22；老板白衬衫也是暖白。
    # 因此判定「干净背景白」要同时满足够亮 且 几乎无色偏。
    nearwhite = (lum > 232) & (np.abs(r - g) < 5) & (np.abs(g - b) < 5)

    # 只在靠近边缘的一圈里做种子，避免把主体深处的白当种子
    ed = max(2, int(min(H, W) * 0.04))
    seedmask = np.zeros_like(nearwhite)
    seedmask[:ed, :] = True
    seedmask[-ed:, :] = True
    seedmask[:, :ed] = True
    seedmask[:, -ed:] = True

    start = nearwhite & seedmask & arr
    if not start.any():
        return arr, 0

    # 洪水填充（4 邻域），只沿 nearwhite 蔓延
    filled = np.zeros_like(start)
    stack = list(zip(*np.where(start)))
    for y, x in stack:
        filled[y, x] = True
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and nearwhite[ny, nx] and not filled[ny, nx]:
                filled[ny, nx] = True
                stack.append((ny, nx))

    kill = filled & arr          # 只清原本被判定为前景的（背景像素本来就透明）
    out = arr & ~kill
    return out, int(kill.sum())


def cutout(src, out, thr=20, pad=4, close=7, keep_ratio=0.05):
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    lum = a.sum(axis=2)
    bg = np.median(a[lum >= np.percentile(lum, 95)], axis=0)
    fg = np.abs(a - bg).sum(axis=2) > thr
    m = Image.fromarray((fg * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))    # 去 JPEG 噪点
    m = m.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))  # 补内部浅色洞
    arr = np.asarray(m) > 127

    arr, killed = clean_edge_white(arr, np.asarray(im))
    if killed: print(f'  边缘浅色清理 {killed}px')

    comps = components(arr)
    if comps:
        comps.sort(key=len, reverse=True)
        keep_thr = max(400, len(comps[0]) * keep_ratio)
        keep = np.zeros_like(arr); dropped = []
        for c in comps:
            if len(c) >= keep_thr:
                for y, x in c: keep[y, x] = True
            else: dropped.append(len(c))
        if dropped: print(f'  丢弃{len(dropped)}个小块(最大{max(dropped)})')
        arr = keep

    ys, xs = np.where(arr)
    bb = (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
          min(im.width, int(xs.max()) + pad + 1), min(im.height, int(ys.max()) + pad + 1))
    im2 = im.crop(bb)
    al = np.asarray(Image.fromarray((arr * 255).astype(np.uint8)).crop(bb))
    Image.fromarray(np.dstack([np.asarray(im2), al]), 'RGBA').save(out)
    print(f'  {out:26} {str(im2.size):12} 不透明={(al > 128).mean() * 100:.0f}%')


JOBS = [
    ("assets/feiyu_work.jpg",    "assets/p_fy_work.png",  7, 0.05),
    ("assets/feiyu_slack.jpg",   "assets/p_fy_slack.png", 7, 0.05),
    ("assets/i2i_doubao.jpg",    "assets/p_db_work.png",  7, 0.05),
    ("assets/doubao_alert3.jpg", "assets/p_db_alert.png", 7, 0.05),
    ("assets/boss_raw.jpg",      "assets/p_boss.png",   13, 0.02),  # 老板块碎，用更大闭运算
]

if __name__ == "__main__":
    import os
    for src, out, cl, kr in JOBS:
        if not os.path.exists(src):
            print("skip missing", src); continue
        print(src); cutout(src, out, close=cl, keep_ratio=kr)