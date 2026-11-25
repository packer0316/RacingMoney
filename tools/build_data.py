# -*- coding: utf-8 -*-
"""
把 tools/cache 的原始資料（OSRM 路線 + Terrarium 高程圖磚）轉成遊戲資料：
  js/data/route_data.js    台9線中心線 (每 2 m 一個取樣點, 本地公尺座標, 平滑後的路面高程)
  js/data/terrain_data.js  25 m 解析度地形高程 (zlib + base64)

座標系：x = 東, y = 上, z = 南 (= -北)，原點為路線範圍中心。
用法:  python -I tools/build_data.py
"""
import base64, json, math, os, zlib
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(ROOT, "js", "data")
os.makedirs(OUT, exist_ok=True)

ZOOM = 13
TX0, TX1, TY0, TY1 = 6860, 6871, 3508, 3513
BBOX = dict(lon0=121.50, lon1=121.98, lat0=24.78, lat1=25.00)
GRID = 25.0          # 地形網格間距 (m)
SPACING = 2.0        # 路線取樣間距 (m)

# 台9線上的實際地標 (OSM Nominatim 查得)
LANDMARKS = [
    ("新店 北宜路起點", 121.54054, 24.953366, "start"),
    ("青潭", 121.54788, 24.95172, "village"),
    ("小格頭", 121.63189, 24.95215, "village"),
    ("坪林", 121.71168, 24.93699, "town"),
    ("石牌 縣界", 121.77374, 24.86569, "border"),
    ("九彎十八拐", 121.79643, 24.85412, "scenic"),
    ("頭城", 121.790869, 24.838382, "end"),
]
BORDER_K = 56.661    # 新北/宜蘭縣界 = 台9線 56K+661 (新北市交通局路段表)

DISTRICT = {
    "北宜路一段": "新北市新店區", "北宜路二段": "新北市新店區", "北宜路三段": "新北市新店區",
    "北宜路四段": "新北市石碇區", "北宜路五段": "新北市石碇區", "北宜路六段": "新北市石碇區",
    "北宜路七段": "新北市坪林區", "北宜路八段": "新北市坪林區", "坪林橋": "新北市坪林區",
    "北宜路九段": "新北市坪林區", "北宜公路": "新北市坪林區",
}


# ---------------------------------------------------------------- DEM
def load_dem():
    w = (TX1 - TX0 + 1) * 256
    h = (TY1 - TY0 + 1) * 256
    dem = np.zeros((h, w), dtype=np.float32)
    for ty in range(TY0, TY1 + 1):
        for tx in range(TX0, TX1 + 1):
            p = os.path.join(CACHE, "dem", f"{ZOOM}_{tx}_{ty}.png")
            a = np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
            hh = a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0
            dem[(ty - TY0) * 256:(ty - TY0 + 1) * 256, (tx - TX0) * 256:(tx - TX0 + 1) * 256] = hh
    return dem


def lonlat_to_px(lon, lat):
    n = 2 ** ZOOM
    x = (lon + 180.0) / 360.0 * n
    latr = np.radians(lat)
    y = (1.0 - np.log(np.tan(latr) + 1.0 / np.cos(latr)) / math.pi) / 2.0 * n
    return (x - TX0) * 256.0 - 0.5, (y - TY0) * 256.0 - 0.5


def bilinear(img, px, py):
    h, w = img.shape
    px = np.clip(px, 0, w - 1.001)
    py = np.clip(py, 0, h - 1.001)
    x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
    fx = px - x0; fy = py - y0
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


# ---------------------------------------------------------------- route geometry
def catmull_rom_resample(pts, step):
    """centripetal Catmull-Rom 穿過所有節點, 以 ~step 細分"""
    P = np.vstack([pts[0] * 2 - pts[1], pts, pts[-1] * 2 - pts[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-3) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-3) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-3) ** 0.5
        seg = np.linalg.norm(p2 - p1)
        n = max(1, int(math.ceil(seg / step)))
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(pts[-1])
    return np.array(out)


def arc_resample(pts, step):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    s = np.arange(0, d[-1], step)
    return np.c_[np.interp(s, d, pts[:, 0]), np.interp(s, d, pts[:, 1])], d[-1]


def gauss_smooth(v, sigma_samples, axis=0):
    r = int(sigma_samples * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_samples) ** 2)
    k /= k.sum()
    pad = np.pad(v, [(r, r)] + [(0, 0)] * (v.ndim - 1), mode="edge")
    if v.ndim == 1:
        return np.convolve(pad, k, mode="valid")
    return np.stack([np.convolve(pad[:, j], k, mode="valid") for j in range(v.shape[1])], axis=1)


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def main():
    route = json.load(open(os.path.join(CACHE, "route_tw9.json"), encoding="utf-8"))["routes"][0]
    coords = np.array(route["geometry"]["coordinates"])  # lon, lat

    # 只取 台9 本線：從北宜路一段起點開始
    start_ll = np.array([121.54054, 24.953366])
    i0 = int(np.argmin(np.linalg.norm(coords - start_ll, axis=1)))
    coords = coords[i0:]

    lon0 = float((coords[:, 0].min() + coords[:, 0].max()) / 2)
    lat0 = float((coords[:, 1].min() + coords[:, 1].max()) / 2)
    phi = math.radians(lat0)
    ky = 111132.954 - 559.822 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    kx = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

    def proj(lon, lat):
        return (np.asarray(lon) - lon0) * kx, -(np.asarray(lat) - lat0) * ky

    def unproj(x, z):
        return lon0 + np.asarray(x) / kx, lat0 - np.asarray(z) / ky

    X, Z = proj(coords[:, 0], coords[:, 1])
    pts = np.c_[X, Z]
    keep = np.r_[True, np.linalg.norm(np.diff(pts, axis=0), axis=1) > 0.5]
    pts = pts[keep]

    dense = catmull_rom_resample(pts, 1.0)
    dense, _ = arc_resample(dense, 1.0)
    dense = gauss_smooth(dense, 3.0)           # 去掉 OSM 折線的尖角 (sigma 3 m)
    res, total = arc_resample(dense, SPACING)
    TRIM = 20                                   # 去掉起點路口轉角 40 m
    res = res[TRIM:]; total -= TRIM * SPACING
    N = len(res)

    # ---------------- DEM
    dem = load_dem()
    lon, lat = unproj(res[:, 0], res[:, 1])
    px, py = lonlat_to_px(lon, lat)
    h_raw = bilinear(dem, px, py)

    # 路面高程：DEM 中心線經強平滑 (道路沿等高線開闢，DEM 雜訊與邊坡誤差需濾除)
    h_road = gauss_smooth(h_raw.astype(np.float64), 22.0)   # sigma 44 m
    # 坡度限制 (北宜最大縱坡約 9%)，前後兩趟掃描
    max_g = 0.095 * SPACING
    for _ in range(3):
        for i in range(1, N):
            h_road[i] = min(max(h_road[i], h_road[i - 1] - max_g), h_road[i - 1] + max_g)
        for i in range(N - 2, -1, -1):
            h_road[i] = min(max(h_road[i], h_road[i + 1] - max_g), h_road[i + 1] + max_g)
        h_road = gauss_smooth(h_road, 6.0)

    # 橋樑偵測：路面比地面高出 > 6 m
    below = h_road - h_raw
    br = below > 9.0
    # 填補小空隙、去除過短片段、前後延伸
    def runs(mask):
        r = []; i = 0
        while i < len(mask):
            if mask[i]:
                j = i
                while j < len(mask) and mask[j]: j += 1
                r.append([i, j]); i = j
            else: i += 1
        return r
    rr = runs(br)
    merged = []
    for a, b in rr:
        if merged and a - merged[-1][1] < 12:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    bridges = [[max(0, a - 6), min(N - 1, b + 6)] for a, b in merged if (b - a) * SPACING >= 24]
    # 坪林橋 (跨北勢溪, 約 120 m) 依 OSM 路段資料強制加入
    bx, bz = proj(121.71071, 24.934983)
    bi = int(np.argmin((res[:, 0] - bx) ** 2 + (res[:, 1] - bz) ** 2))
    bridges.append([bi - 4, bi + 64])
    bridges.sort()

    # ---------------- names / districts
    names = []
    acc = 0.0
    cut = 0.0
    # 找出被裁掉的起點距離 (能仁街)
    first = True
    for leg in route["legs"]:
        for st in leg["steps"]:
            nm = st.get("name", "")
            if first:
                cut = st["distance"] if nm == "能仁街" else 0.0
                first = False
            if st["distance"] > 0 and nm and nm != "能仁街":
                si = max(0, int(max(0.0, acc - cut) / SPACING) - TRIM)
                if names and names[-1][0] == si:
                    names[-1] = [si, nm, DISTRICT.get(nm, "宜蘭縣頭城鎮")]
                elif not names or names[-1][1] != nm:
                    names.append([si, nm, DISTRICT.get(nm, "宜蘭縣頭城鎮")])
            acc += st["distance"]

    # ---------------- landmarks
    lms = []
    for name, lo, la, kind in LANDMARKS:
        x, z = proj(lo, la)
        i = int(np.argmin((res[:, 0] - x) ** 2 + (res[:, 1] - z) ** 2))
        lms.append({"i": i, "name": name, "kind": kind})
    border_i = [l["i"] for l in lms if l["kind"] == "border"][0]
    km_offset = BORDER_K - border_i * SPACING / 1000.0
    # 縣界之後屬於宜蘭縣
    for n in names:
        if n[0] >= border_i - 5 and n[2].startswith("新北"):
            n[2] = "宜蘭縣頭城鎮"
    if not any(n[0] == border_i for n in names):
        names.append([border_i, "北宜公路", "宜蘭縣頭城鎮"])
        names.sort(key=lambda n: n[0])

    xyz = np.zeros((N, 3), dtype=np.float32)
    xyz[:, 0] = res[:, 0]; xyz[:, 1] = h_road; xyz[:, 2] = res[:, 1]

    route_js = {
        "origin": {"lon": lon0, "lat": lat0, "kx": kx, "ky": ky},
        "spacing": SPACING, "count": N, "length": float(total),
        "xyz": b64(xyz),
        "demCenter": b64(h_raw.astype(np.float32)),
        "bridges": bridges, "names": names, "landmarks": lms,
        "kmOffset": km_offset,
        "source": "OpenStreetMap contributors (ODbL) via OSRM; elevation: AWS Terrain Tiles (SRTM/ETOPO)",
    }
    with open(os.path.join(OUT, "route_data.js"), "w", encoding="utf-8") as f:
        f.write("// 自動產生 - tools/build_data.py\nwindow.RM_DATA = window.RM_DATA || {};\nRM_DATA.route = ")
        f.write(json.dumps(route_js, ensure_ascii=False))
        f.write(";\n")

    # ---------------- terrain grid
    xa, za = proj(np.array([BBOX["lon0"], BBOX["lon1"]]), np.array([BBOX["lat1"], BBOX["lat0"]]))
    gx0 = math.ceil(xa[0] / GRID) * GRID; gx1 = math.floor(xa[1] / GRID) * GRID
    gz0 = math.ceil(za[0] / GRID) * GRID; gz1 = math.floor(za[1] / GRID) * GRID
    nx = int((gx1 - gx0) / GRID) + 1; nz = int((gz1 - gz0) / GRID) + 1
    gx = gx0 + np.arange(nx) * GRID
    gz = gz0 + np.arange(nz) * GRID
    GX, GZ = np.meshgrid(gx, gz)
    glon, glat = unproj(GX, GZ)
    gpx, gpy = lonlat_to_px(glon, glat)
    H = bilinear(dem, gpx.ravel(), gpy.ravel()).reshape(nz, nx)
    H = np.maximum(H, -40.0)
    H[H < 0.5] = -6.0          # 海面以下壓低，避免與海平面 z-fighting
    # SRTM 整數公尺階梯在平原會形成棋盤狀明暗：輕微平滑，平原 (h<40 m) 加強
    def _blur(a, sig):
        r = int(sig * 3)
        k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2); k /= k.sum()
        pad = np.pad(a, r, mode='edge')
        t = np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), 1, pad)
        return np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), 0, t)
    H1 = _blur(H, 0.8)
    H3 = _blur(H, 2.5)
    wlow = np.clip((60.0 - H1) / 40.0, 0.0, 1.0)
    H = H1 * (1 - wlow) + H3 * wlow
    q = np.round(H * 4.0).astype(np.int32)
    dq = np.diff(q, axis=1, prepend=0).astype(np.int16)
    comp = zlib.compress(dq.tobytes(), 9)
    terr_js = {"x0": gx0, "z0": gz0, "spacing": GRID, "nx": nx, "nz": nz, "scale": 0.25,
               "data": base64.b64encode(comp).decode("ascii")}
    with open(os.path.join(OUT, "terrain_data.js"), "w", encoding="utf-8") as f:
        f.write("// 自動產生 - tools/build_data.py\nwindow.RM_DATA = window.RM_DATA || {};\nRM_DATA.terrain = ")
        f.write(json.dumps(terr_js))
        f.write(";\n")

    # ---------------- report
    g = np.diff(h_road) / SPACING
    tx = np.gradient(res[:, 0]); tz = np.gradient(res[:, 1])
    hd = np.unwrap(np.arctan2(tz, tx))
    curv = np.abs(np.gradient(hd)) / SPACING
    print(f"origin {lon0:.5f},{lat0:.5f}  samples {N}  length {total/1000:.2f} km")
    print(f"road elev {h_road.min():.0f}..{h_road.max():.0f} m (at {np.argmax(h_road)*SPACING/1000:.2f} km); max grade {np.abs(g).max()*100:.1f}%")
    print(f"min radius {1/curv.max():.1f} m; radius<30m count {(gauss_smooth(curv,2)>1/30).sum()}")
    print("bridges:", [(round(a*SPACING/1000, 2), round((b-a)*SPACING)) for a, b in bridges])
    print("names:", [(round(n[0]*SPACING/1000,2), n[1]) for n in names])
    print("landmarks:", [(l['name'], round(l['i']*SPACING/1000, 2)) for l in lms], "km_offset", round(km_offset, 3))
    print(f"terrain {nx}x{nz} grid, {H.min():.0f}..{H.max():.0f} m, {len(comp)/1e6:.2f} MB compressed")


if __name__ == "__main__":
    main()
