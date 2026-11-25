# -*- coding: utf-8 -*-
"""
下載北宜公路 (台9線) 的真實資料：
  1. 路線幾何：OSRM (OpenStreetMap 路網) 依台9線上的途經點規劃
  2. 地形高程：AWS Terrain Tiles (Terrarium 格式, SRTM/ETOPO 來源), zoom 13 (~17 m/px)

用法:  python tools/fetch_data.py
輸出到 tools/cache/
"""
import math, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DEM_DIR = os.path.join(CACHE, "dem")
os.makedirs(DEM_DIR, exist_ok=True)

UA = "racing-game-dev/1.0"

# 途經點全部落在台9線上 (新店 北宜路一段 -> 小格頭 -> 坪林橋 -> 九彎十八拐 -> 頭城 青雲路口)
WAYPOINTS = [
    (121.539692, 24.957791),
    (121.631902, 24.951788),
    (121.710959, 24.933926),
    (121.775653, 24.865120),
    (121.790869, 24.838382),
]

# 地形範圍：包含雪山山脈北段、蘭陽平原北端海岸與龜山島
BBOX = dict(lon0=121.50, lon1=121.98, lat0=24.78, lat1=25.00)
ZOOM = 13


def curl(url, out):
    cmd = ["curl", "-sS", "--ssl-no-revoke", "-m", "90", "-A", UA, "-o", out, "-w", "%{http_code}", url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip()


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch_route():
    out = os.path.join(CACHE, "route_tw9.json")
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        print("route cached")
        return
    coords = ";".join(f"{lo},{la}" for lo, la in WAYPOINTS)
    url = (f"https://router.project-osrm.org/route/v1/driving/{coords}"
           "?overview=full&geometries=geojson&steps=true&continue_straight=true")
    print("route:", curl(url, out))


def fetch_dem():
    x0, y0 = tile_xy(BBOX["lon0"], BBOX["lat1"], ZOOM)
    x1, y1 = tile_xy(BBOX["lon1"], BBOX["lat0"], ZOOM)
    for ty in range(int(y0), int(y1) + 1):
        for tx in range(int(x0), int(x1) + 1):
            out = os.path.join(DEM_DIR, f"{ZOOM}_{tx}_{ty}.png")
            if os.path.exists(out) and os.path.getsize(out) > 1000:
                continue
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{tx}/{ty}.png"
            code = curl(url, out)
            print("dem", tx, ty, code)
            time.sleep(0.05)


if __name__ == "__main__":
    fetch_route()
    fetch_dem()
    print("done")
