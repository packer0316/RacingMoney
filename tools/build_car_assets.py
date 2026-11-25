# -*- coding: utf-8 -*-
"""
下載並打包路上車流用的 glTF 汽車模型 → js/data/car_assets.js (base64，讓 file:// 也能直接使用)
玩家車款 (喜美 K8、GR86) 是程序化模型 (js/car/)，不在這裡。

來源與授權：
  * Kenney Car Kit 3.1 — CC0 (https://kenney.nl/assets/car-kit，經 OpenGameArt 下載)
用法:  python -I tools/build_car_assets.py
"""
import base64, json, os, subprocess, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache", "models")
OUT_JS = os.path.join(ROOT, "js", "data", "car_assets.js")
OUT_DIR = os.path.join(ROOT, "assets", "models")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

KENNEY_ZIP = "https://opengameart.org/sites/default/files/kenney_car-kit_3.1.zip"

KENNEY_MODELS = [
    "sedan", "sedan-sports", "hatchback-sports", "suv", "suv-luxury", "taxi", "police", "van",
    "delivery", "truck", "truck-flat", "garbage-truck", "ambulance", "firetruck",
]


def curl(url, out):
    if os.path.exists(out) and os.path.getsize(out) > 1000:
        return
    r = subprocess.run(["curl", "-sS", "--ssl-no-revoke", "-m", "180", "-L", "-A", "Mozilla/5.0", "-o", out, url])
    if r.returncode != 0:
        raise SystemExit("download failed: " + url)


def main():
    kz = os.path.join(CACHE, "kenney_car-kit_3.1.zip")
    curl(KENNEY_ZIP, kz)
    z = zipfile.ZipFile(kz)
    data = {}
    kdir = os.path.join(OUT_DIR, "kenney")
    os.makedirs(kdir, exist_ok=True)
    for m in KENNEY_MODELS:
        b = z.read("Models/GLB format/%s.glb" % m)
        open(os.path.join(kdir, m + ".glb"), "wb").write(b)
        data["kenney/" + m] = base64.b64encode(b).decode("ascii")
    cm = z.read("Models/GLB format/Textures/colormap.png")
    open(os.path.join(kdir, "colormap.png"), "wb").write(cm)
    data["kenney/colormap.png"] = base64.b64encode(cm).decode("ascii")
    open(os.path.join(kdir, "License.txt"), "wb").write(z.read("License.txt"))
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("// 自動產生 - tools/build_car_assets.py\n")
        f.write("// Kenney Car Kit (CC0)：路上車流用的車輛模型\n")
        f.write("window.RM_DATA = window.RM_DATA || {};\nRM_DATA.cars = ")
        f.write(json.dumps(data))
        f.write(";\n")
    print("wrote", OUT_JS, round(os.path.getsize(OUT_JS) / 1e6, 2), "MB,", len(data), "files")


if __name__ == "__main__":
    main()
