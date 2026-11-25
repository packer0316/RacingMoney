#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""山道猴王 — 打包成金碟遊樂場 (GoldSaucer) 的上傳檔

    python tools/pack_goldsaucer.py        → dist/shandao-monkey-king.zip

只收遊戲執行需要的檔案 (index.html、goldsaucer.json、封面、css/、js/、images/、audio/、vendor/、server/)，
不含 tools/、assets/ 原始模型 (已內嵌在 js/data/car_assets.js)、README。
打包時順便：
  * 把 model_loader.js 裡「直接開 index.html 才會用到」的 CDN 網址拿掉 (平台上一律用 vendor/three/，不連外)
  * 依平台規定檢查：檔案數 / 單檔大小 / 總大小 / 封面 / 房間腳本與伺服器函式大小 / goldsaucer.json 格式
  * 列出包裡還出現的外部網址與動態執行程式碼 (平台的內容掃描會標出這些)
"""
import io, json, os, re, sys, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'dist', 'shandao-monkey-king.zip')
INCLUDE_DIRS = ['css', 'js', 'images', 'audio', 'vendor', 'server']
INCLUDE_FILES = ['index.html', 'goldsaucer.json']
SKIP_EXT = {'.map', '.md', '.py', '.bak', '.orig', '.tmp'}
# 平台限制
MAX_FILES, MAX_FILE, MAX_TOTAL, MAX_ZIP = 2000, 20 * 2**20, 200 * 2**20, 100 * 2**20
MAX_ROOM, MAX_FN, MAX_COVER = 2**20, 256 * 1024, 2**20
ALLOW_URL = ('http://www.w3.org/', 'https://discourse.threejs.org/')   # XML 命名空間、three.js 的提示文字 (不會連線)


def fail(msg):
    print('✗ ' + msg)
    sys.exit(1)


def transform(rel, data):
    """打包時對個別檔案的調整"""
    if rel == 'js/car/model_loader.js':
        s = data.decode('utf-8')
        s, n = re.subn(r"'https://(?:cdn\.jsdelivr\.net|www\.gstatic\.com)[^']*'", "''", s)
        if n == 0:
            print('  (model_loader.js 裡沒有找到 CDN 網址，略過)')
        return s.encode('utf-8')
    return data


def main():
    mf_path = os.path.join(ROOT, 'goldsaucer.json')
    try:
        mf = json.load(io.open(mf_path, encoding='utf-8'))
    except Exception as e:
        fail('goldsaucer.json 不是合法的 JSON (不能有註解)：%s' % e)
    if not isinstance(mf, dict):
        fail('goldsaucer.json 必須是物件')

    files = []
    for f in INCLUDE_FILES:
        files.append(f)
    cover = mf.get('cover')
    if cover:
        files.append(cover)
    for d in INCLUDE_DIRS:
        for base, _dirs, names in os.walk(os.path.join(ROOT, d)):
            for n in names:
                if os.path.splitext(n)[1].lower() in SKIP_EXT or n.startswith('.'):
                    continue
                files.append(os.path.relpath(os.path.join(base, n), ROOT).replace('\\', '/'))
    files = sorted(set(files))

    for key in ('entry', 'server', 'functions', 'cover'):
        v = mf.get(key) or ('index.html' if key == 'entry' else None)
        if v and v not in files:
            fail('goldsaucer.json 的 %s 指向不存在的檔案：%s' % (key, v))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    total, urls, dyn = 0, {}, []
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in files:
            data = open(os.path.join(ROOT, rel), 'rb').read()
            data = transform(rel, data)
            if len(data) > MAX_FILE:
                fail('%s 超過單檔 20 MB (%.1f MB)' % (rel, len(data) / 2**20))
            total += len(data)
            if rel.endswith(('.js', '.html', '.css', '.json')) and not rel.startswith('js/data/'):
                text = data.decode('utf-8', 'replace')
                for u in set(re.findall(r'''https?://[^\s'"`)<>\\]+''', text)):
                    if not u.startswith(ALLOW_URL):
                        urls.setdefault(u, []).append(rel)
                if rel.startswith(('js/', 'server/')) or rel.endswith('.html'):
                    if re.search(r'\beval\s*\(|new\s+Function\s*\(', text):
                        dyn.append(rel)
            z.writestr(zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)

    size = os.path.getsize(OUT)
    checks = [
        (len(files) <= MAX_FILES, '檔案數 %d (上限 %d)' % (len(files), MAX_FILES)),
        (total <= MAX_TOTAL, '解壓後 %.1f MB (上限 200 MB)' % (total / 2**20)),
        (size <= MAX_ZIP, 'zip %.1f MB (上限 100 MB)' % (size / 2**20)),
    ]
    if mf.get('server'):
        n = os.path.getsize(os.path.join(ROOT, mf['server']))
        checks.append((n <= MAX_ROOM, '房間腳本 %.1f KB (上限 1 MB)' % (n / 1024)))
        src = io.open(os.path.join(ROOT, mf['server']), encoding='utf-8').read()
        checks.append((bool(re.search(r'^defineRoom\(', src, re.M)), '房間腳本在最上層呼叫 defineRoom()'))
    if mf.get('functions'):
        n = os.path.getsize(os.path.join(ROOT, mf['functions']))
        checks.append((n <= MAX_FN, '伺服器函式 %.1f KB (上限 256 KB)' % (n / 1024)))
        src = io.open(os.path.join(ROOT, mf['functions']), encoding='utf-8').read()
        checks.append((bool(re.search(r'^defineFunctions\(', src, re.M)), '伺服器函式在最上層呼叫 defineFunctions()'))
    if cover:
        n = os.path.getsize(os.path.join(ROOT, cover))
        checks.append((n <= MAX_COVER and cover.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')), '封面 %s %.0f KB (上限 1 MB)' % (cover, n / 1024)))
    html = io.open(os.path.join(ROOT, mf.get('entry', 'index.html')), encoding='utf-8').read()
    ext_tags = re.findall(r'''<(?:script|link|img|audio|video|iframe)[^>]+(?:src|href)=["'](?:https?:)?//[^"']+''', html)
    checks.append((not ext_tags, '入口 html 沒有載入外部資源'))
    checks.append(('serviceWorker' not in html, '沒有註冊 Service Worker'))

    bad = False
    for ok, msg in checks:
        print(('✓ ' if ok else '✗ ') + msg)
        bad = bad or not ok
    if urls:
        print('! 包裡出現的外部網址 (平台掃描會標出，交給管理員判斷)：')
        for u, where in sorted(urls.items()):
            print('    %s  ← %s' % (u, ', '.join(sorted(set(where)))))
    else:
        print('✓ 沒有外部網址')
    if dyn:
        print('! 含有動態執行程式碼 (eval / new Function)：' + ', '.join(dyn))
    else:
        print('✓ 沒有動態執行程式碼')
    if bad:
        fail('有項目不符合平台規定，請修正後再打包')
    print('\n→ %s  (%.1f MB，%d 個檔案)' % (OUT, size / 2**20, len(files)))
    print('  上傳：金碟遊樂場 → 上傳遊戲 → 選這個 zip。標題建議填「山道猴王」。')


if __name__ == '__main__':
    # Windows 主控台預設是 cp950，印不出 ✓ / ✗
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
