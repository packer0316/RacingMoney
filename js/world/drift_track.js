'use strict';
// 熱浪夏威夷：俯衝高速 S、越轉越緊的環匝、長陡坡上的斷崖飛越、谷底連續髮夾與駝峰高速彎。
// 這個檔負責路形與路上的設施；路以外的場景 (夏威夷夕陽海灘：地形、海、棕櫚樹、建築) 在 drift_theme.js。
(function () {
  const RM = window.RM;
  const spacing = 2;
  // 數字 = 直線長 (m)；[角度° (+右 / -左), 半徑 m] = 彎；{ arcs } = 複合彎 (半徑在彎中改變)。
  // 開場：俯衝直線 → 高速 S → 谷底回頭彎 → 上坡左彎，坡頂直接切進環匝。
  const opening = [190, [50, 110], 14, [-60, 88], 58, [172, 27], 22, [-112, 30], 30];
  const ring = { arcs: [[150, 60], [210, 40]] }; // 一圈，越轉越緊 (直徑約 120 → 80 m)。
  const connector = [22, { arcs: [[-46, 70], [-70, 40]] }, 16, { arcs: [[62, 40], [48, 66]] }, 40];
  const approach = [...opening, ring, ...connector];
  const runout = 420;   // 斷崖對岸到谷底彎的距離：落地 + 上坡緩衝 + 煞車
  const downhillLength = 250 + 40 + runout;
  const valley = [90, 105]; // 飛越後車速很高：半徑固定的大彎 (原本是越轉越緊到 R27 的急彎，根本煞不下來)。
  const hairpins = [40, { arcs: [[-60, 75], [-90, 48]] }, 30, { arcs: [[100, 48], [50, 70]] }, 30, [-130, 50]];
  const exit = [96, [64, 70], 36, [-52, 85], 50, [48, 80]];
  const startElevation = 260;
  const distanceOf = elements => RM.Road.traceLayout(elements).ss.at(-1);
  const turnAngle = element => element.arcs ? element.arcs.reduce((sum, [degrees]) => sum + degrees, 0) : element[0];
  const even = s => Math.round(s / spacing) * spacing;
  const nextMarker = s => Math.ceil(s / spacing) * spacing + 2;
  // 各段在 elements 裡的 [起點, 終點] 里程。
  const spans = (elements, offset = 0) => elements.map((_, i) => [offset + distanceOf(elements.slice(0, i)), offset + distanceOf(elements.slice(0, i + 1))]);
  const openingSpans = spans(opening);
  const backTurn = openingSpans[5], climbTurn = openingSpans[7];
  const ringLength = distanceOf([ring]);
  const spiral = { start: distanceOf(opening), end: distanceOf([...opening, ring]), turns: 1, radius: ring.arcs[0][1], lapLength: ringLength };
  const descentStart = distanceOf(approach), valleyTurn = descentStart + downhillLength;
  const hairpinStart = valleyTurn + distanceOf([valley]);
  const townSpans = spans(hairpins, hairpinStart);
  const [townA, townB, townC] = [townSpans[1], townSpans[3], townSpans[5]];
  const crestStart = hairpinStart + distanceOf(hairpins);
  const exitSpans = spans(exit, crestStart);
  const [humpA, humpB, humpC] = [exitSpans[1], exitSpans[3], exitSpans[5]];
  const exitEnd = crestStart + distanceOf(exit);
  const finish = Math.ceil((exitEnd + 70) / 20) * 20;
  // 斷崖：長陡坡上的高架橋斷了 40 m，要時速 180 以上才飛得過。
  // 對岸的橋頭大致落在「長陡坡原本的坡面」上；起跳前坡度放緩成 lip (相對坡面往上翹一點)，
  // 車速夠快才能在掉回坡面之前飛到對岸。門檻車速由 drop 決定：對岸每低 0.1 m，門檻大約降 2.5 km/h
  // (實測 6.6 m → 約 173、6.2 m → 約 185；六台車都一樣)。喜美 K8 不用氮氣只到 155 左右，要留氮氣在長陡坡用。
  // 落地坡 (landing) 比原本的坡面再陡一點，越快飛得越遠、落地也不會太重。沒飛過會掉進溪谷，從對岸重新出發 (main.js)。
  const cliffStart = even(descentStart + 250);
  const cliff = { start: cliffStart, end: cliffStart + 40, drop: 6.35, depth: 16, lip: -.095, landing: -.18, deck: 26 };
  const cliffGrade = -cliff.drop / (cliff.end - cliff.start);
  const section = {
    name: '熱浪夏威夷', s0: 60, s1: finish, recordVersion: 10,
    cps: [{ name: '環匝出口', s: nextMarker(spiral.end) },
      { name: '斷崖落地', s: cliff.end + 40 },
      { name: '谷底直角彎', s: nextMarker(hairpinStart) }],
  };
  const length = section.s1 + 160;
  const viaduct = [Math.floor((spiral.start - 22) / spacing) * spacing, Math.ceil((spiral.end + 24) / spacing) * spacing];
  // 橋面 (畫側面與底面的範圍)：環匝，以及斷崖兩岸的斷橋。
  const decks = [viaduct, [cliff.start - cliff.deck, cliff.start], [cliff.end, cliff.end + cliff.deck]];
  // [沿線公尺, 坡度]。整條路是一路往下，但中間有四段上坡、三個坡頂與一個谷底：
  // 開場俯衝 → 回頭彎谷底 → 爬到環匝入口的坡頂 → 環匝盤旋而下 → 爬上山脊 → 長陡坡 (斷崖) → 谷底壓縮上坡 →
  // 城鎮髮夾一層一層往下 (彎裡陡、彎間平) → 跳坡 → 三個駝峰高速彎。
  const grades = [
    [0, -.015], [100, -.03], [150, -.115], [backTurn[0] - 96, -.105], [backTurn[0] - 30, -.05],
    [backTurn[0] + 36, .0], [backTurn[1] - 6, .07], [climbTurn[0] + 20, .09],
    [spiral.start - 40, .085], [spiral.start - 6, -.01],
    [spiral.start + 26, -.08], [spiral.end - 30, -.08], [spiral.end + 10, -.03],
    [descentStart - 124, -.02], [descentStart - 76, .08], [descentStart - 30, .07], [descentStart, -.02],
    [descentStart + 34, -.15], [descentStart + 60, -.165], [cliff.start - 50, -.165], [cliff.start - 10, cliff.lip],
    [cliff.start, cliff.lip], [cliff.start + .01, cliffGrade], [cliff.end - .01, cliffGrade], [cliff.end, cliff.landing],
    // 落地區之後由下坡轉成一段陡上坡 (V 形谷底)：放開油門車速就會自己掉，上坡煞車也短、也穩；坡頂前放緩再進彎。
    [cliff.end + 50, cliff.landing], [cliff.end + 210, .11],
    [valleyTurn - 150, .11], [valleyTurn - 60, .02], [valleyTurn + 60, .01], [hairpinStart, .0],
    [townA[0] + 10, -.08], [townA[1] - 16, -.08], [townA[1] + 4, -.015],
    [townB[0] + 12, -.08], [townB[1] - 16, -.08], [townB[1] + 4, -.015],
    [townC[0] + 12, -.08], [townC[1] - 20, -.075], [crestStart, -.02],
    [crestStart + 24, .068], [crestStart + 36, .09], [crestStart + 46, -.10], [crestStart + 60, -.078],
    // 駝峰：坡頂都落在彎與彎之間的直線上 (車身變輕)，彎裡是谷底 (壓縮、抓地力最好)。
    [humpA[0] - 6, -.085], [humpA[0] + 36, -.03], [humpA[1] - 16, .05], [humpA[1] + 4, .05],
    [humpA[1] + 28, -.10], [humpB[0], -.10], [humpB[0] + 44, -.04], [humpB[1] - 24, .01], [humpB[1] + 8, .055],
    [humpB[1] + 34, -.10], [humpC[0], -.10], [humpC[0] + 40, -.05], [humpC[1], -.04],
    [finish - 30, -.03], [finish, -.012], [length, -.006],
  ];

  const layout = [...approach, downhillLength, valley, ...hairpins, ...exit];
  const trace = RM.Road.traceLayout(layout, 0, 0, 0, length);
  const count = length / spacing + 1;
  const points = new Float32Array(count * 3);
  let elevation = startElevation;
  for (let i = 0, j = 0, k = 0; i < count; i++) {
    const s = i * spacing;
    while (j < trace.ss.length - 2 && trace.ss[j + 1] < s) j++;
    const t = RM.clamp((s - trace.ss[j]) / (trace.ss[j + 1] - trace.ss[j]), 0, 1);
    if (i > 0) {
      const midpoint = s - spacing / 2;
      while (grades[k + 1][0] < midpoint) k++;
      const [a, g0] = grades[k], [b, g1] = grades[k + 1];
      elevation += spacing * RM.lerp(g0, g1, RM.smoothstep(a, b, midpoint));
    }
    points[i * 3] = RM.lerp(trace.xs[j], trace.xs[j + 1], t);
    points[i * 3 + 1] = elevation;
    points[i * 3 + 2] = RM.lerp(trace.zs[j], trace.zs[j + 1], t);
  }
  const pointAt = s => { const i = Math.round(s / spacing) * 3; return [points[i], points[i + 1], points[i + 2]]; };
  // 溪谷：谷底高度，以及沿路方向 (溪谷與道路垂直)。
  const ravine = (() => {
    const a = pointAt(cliff.start), b = pointAt(cliff.end), l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return { x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, tx: (b[0] - a[0]) / l, tz: (b[2] - a[2]) / l, half: l / 2, floor: b[1] - 12 };
  })();

  // 技術路段 (回頭彎到環匝出口、谷底到城鎮出口) 收窄成半寬約 8.8 m，高速路段維持四線道。
  const narrowSections = [[backTurn[0], spiral.end], [hairpinStart + 30, crestStart]];
  function halfWidth(s) {
    let narrow = 0;
    for (const [start, end] of narrowSections) {
      narrow = Math.max(narrow, Math.min(RM.smoothstep(start - 30, start + 6, s), 1 - RM.smoothstep(end - 6, end + 30, s)));
    }
    return 10.2 - 1.4 * narrow;
  }

  const data = {
    count, spacing, points, spiral, closedCourse: true, kmOffset: -section.s0 / 1000,
    halfWidth,
    bridges: [viaduct, [cliff.start - cliff.deck, cliff.end + cliff.deck]].map(range => range.map(s => s / spacing)),
    // 飛越路段 (高速穩定輔助的範圍)：整段長陡坡，到谷底彎前 30 m。
    gaps: [[cliff.start, cliff.end, cliff.depth, 250, runout - 30]], landmarks: [],
    names: [[0, section.name, '高速公路'], [opening[0] / spacing, section.name, '俯衝高速 S 彎'],
      [(backTurn[0] - 40) / spacing, section.name, '谷底回頭彎'],
      [spiral.start / spacing, section.name, '盤旋匝道'], [spiral.end / spacing, section.name, '複合匝道'],
      [(descentStart - 40) / spacing, section.name, '斷崖飛越 · 時速 180 以上'],
      [(cliff.end + 90) / spacing, section.name, '長陡坡'],
      [valleyTurn / spacing, section.name, '谷底直角彎'], [hairpinStart / spacing, section.name, '城鎮連續髮夾'],
      [crestStart / spacing, section.name, '城鎮出口'], [humpA[0] / spacing, section.name, '駝峰高速彎']],
  };

  // 地面：主題的自然地形 (海岸、沙灘、起伏) 加上道路的路堤，路的兩側保留路拱和路肩的空間；外緣沉進海裡。
  function buildGround(stage, theme) {
    const step = 8, margin = 320, samples = [];
    const ringFloor = points[Math.round(spiral.end / spacing) * 3 + 1] - 6;
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i], y = points[i + 1], z = points[i + 2];
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
      zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
      if (i % 12 === 0 || i === points.length - 3) {
        const s = i / 3 * spacing;
        const ramp = Math.min(RM.smoothstep(viaduct[0] - 36, viaduct[0], s), 1 - RM.smoothstep(viaduct[1], viaduct[1] + 36, s));
        samples.push([x, RM.lerp(y, Math.min(y, ringFloor), ramp), z]);
      }
    }
    const x0 = xmin - margin, z0 = zmin - margin;
    const nx = Math.ceil((xmax + margin - x0) / step) + 1;
    const nz = Math.ceil((zmax + margin - z0) / step) + 1;
    const x1 = x0 + (nx - 1) * step, z1 = z0 + (nz - 1) * step;
    const height = new Float32Array(nx * nz), inRavine = new Uint8Array(nx * nz), nearRoad = new Float32Array(nx * nz);
    theme.bounds(x0, z0, x1, z1);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      let mound = theme.natural(x, z), clearance = Infinity, near = Infinity;
      for (const [rx, ry, rz] of samples) {
        const dx = x - rx, dz = z - rz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < near) near = d;
        mound = Math.max(mound, ry - 2.5 - Math.max(0, d - 10) * .42);
        clearance = Math.min(clearance, ry - 2.5 + Math.max(0, d - 22) * .9);
      }
      // 溪谷把路堤橫向切開：谷底比缺口寬一點，兩岸是斜坡 (藏在斷橋底下)，往兩旁延伸約 90 m 後收掉。
      const dx = x - ravine.x, dz = z - ravine.z;
      const along = Math.abs(dx * ravine.tx + dz * ravine.tz), across = Math.abs(dz * ravine.tx - dx * ravine.tz);
      const cut = ravine.floor + Math.max(0, along - ravine.half - 2) * .75 + Math.max(0, across - 90) * .5;
      height[j * nx + i] = theme.island(x, z, Math.min(mound, clearance, cut));
      inRavine[j * nx + i] = cut < Math.min(mound, clearance) && cut < ravine.floor + .5 ? 1 : 0;
      nearRoad[j * nx + i] = near;
    }

    const at = (i, j) => height[j * nx + i];
    const normal = [0, 1, 0];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      normal[0] = (at(Math.max(0, i - 1), j) - at(Math.min(nx - 1, i + 1), j)) / (2 * step);
      normal[1] = 1;
      normal[2] = (at(i, Math.max(0, j - 1)) - at(i, Math.min(nz - 1, j + 1))) / (2 * step);
      RM.v3.norm(normal, normal);
      const x = x0 + i * step, z = z0 + j * step;
      const material = theme.groundMaterial(x, z, at(i, j), normal[1], inRavine[j * nx + i], nearRoad[j * nx + i]);
      const a = stage.v(x, at(i, j), z, ...normal, ...material.uv, material);
      if (i > 0 && j > 0) {
        stage.tri(a - nx - 1, a - 1, a);
        stage.tri(a - nx - 1, a, a - nx);
      }
    }
    function sample(x, z) {
      const u = RM.clamp((x - x0) / step, 0, nx - 1), v = RM.clamp((z - z0) / step, 0, nz - 1);
      const i = Math.min(Math.floor(u), nx - 2), j = Math.min(Math.floor(v), nz - 2);
      const a = u - i, b = v - j;
      const y0 = at(i, j), y1 = at(i + 1, j + 1);
      return b > a ? y0 + b * (at(i, j + 1) - y0) + a * (y1 - at(i, j + 1))
        : y0 + a * (at(i + 1, j) - y0) + b * (y1 - at(i + 1, j));
    }
    // 離最近路段中心線的水平距離 (最近的格點，給主題擺放景物用)
    const near = (x, z) => nearRoad[RM.clamp(Math.round((z - z0) / step), 0, nz - 1) * nx + RM.clamp(Math.round((x - x0) / step), 0, nx - 1)];
    return { x0, z0, x1, z1, sample, natural: sample, near };
  }

  function drawChevron(stage, point, material) {
    stage.quad(point(.15, .12), point(.43, .12), point(.85, .5), point(.57, .5), material);
    stage.quad(point(.57, .5), point(.85, .5), point(.43, .88), point(.15, .88), material);
  }

  // Folded metal rim and four raised fasteners, merged into the existing static mesh.
  function signFinish(stage, point, width, height) {
    const rim = RM.mat('#c8d3cd', .4, .65, 29), bolt = RM.mat('#b4bdc0', .3, .85, 29);
    const u = .045 / width, v = .045 / height;
    const strip = (x0, y0, x1, y1) => stage.quad(point(x0, y0, .014), point(x1, y0, .014), point(x1, y1, .014), point(x0, y1, .014), rim);
    strip(.015, .035, .985, .035 + v); strip(.015, .965 - v, .985, .965);
    strip(.015, .035, .015 + u, .965); strip(.985 - u, .035, .985, .965);
    for (const x of [.035, .965]) for (const y of [.10, .90]) {
      stage.cyl(point(x, y, .015), point(x, y, .045), .042, .035, 6, bolt, true);
    }
  }

  function buildTurnWarnings(stage, road) {
    const yellow = RM.mat('#ffca22', .48, .05, 20, .12);
    const black = RM.mat('#101315', .6, .05, 20);
    let start = 0;
    for (const element of layout) {
      if (typeof element === 'number') { start += element; continue; }
      const angle = turnAngle(element), span = distanceOf([element]);
      if (Math.abs(angle) >= (element.arcs ? 85 : 90) && Math.abs(angle) < 180) {
        // 連續黃底沿外側護牆延伸。黑色箭頭沿著彎道方向指向出口。
        const side = -Math.sign(angle), from = start + 2, width = Math.min(54, span * .68);
        const panels = Math.max(4, Math.round(width / 4.4));
        const edge = s => {
          const f = road.frameAt(s, {});
          return road.pointAt(s, side * (f.W + 1.02), {});
        };
        let a = edge(from);
        for (let i = 0; i < panels; i++) {
          const b = edge(from + width * (i + 1) / panels);
          const point = (u, v, offset = 0) => [
            RM.lerp(a.px - a.rx * offset * side, b.px - b.rx * offset * side, u),
            RM.lerp(a.py, b.py, u) + .64 + v * 2.55,
            RM.lerp(a.pz - a.rz * offset * side, b.pz - b.rz * offset * side, u),
          ];
          stage.quad(point(0, 0), point(1, 0), point(1, 1), point(0, 1), yellow);
          drawChevron(stage, (u, v) => point(u, v, .055), black);
          signFinish(stage, point, width / panels, 2.55);
          a = b;
        }
      }
      start += span;
    }

    // 跳坡前兩側都顯示落地後的彎向。箭頭取自坡後第一個彎。
    const f = road.frameAt(crestStart + 7, {}), turn = Math.sign(turnAngle(exit[1]));
    const yaw = Math.atan2(-f.rz, f.rx);
    const signWidth = 3.4, signHeight = 2.28, signY = f.y + 2.65;
    for (const side of [-1, 1]) {
      const d = side * (f.W + 2.7), x = f.x + f.rx * d, z = f.z + f.rz * d;
      const bottom = road.hm.sample(x, z), postTop = signY - signHeight * .5 + .06;
      stage.box(x, (bottom + postTop) * .5, z, .24, postTop - bottom, .2, yaw, black);
      stage.box(x, signY, z, signWidth, signHeight, .24, yaw, yellow);
      const point = (u, v, depth = 0) => {
        const lateral = (u - .5) * signWidth * turn;
        return [x + f.rx * lateral - f.tx * (.145 + depth), signY + (v - .5) * signHeight, z + f.rz * lateral - f.tz * (.145 + depth)];
      };
      drawChevron(stage, point, black);
      signFinish(stage, point, signWidth, signHeight);
    }
  }

  function buildHighway(stage, road) {
    const concrete = RM.mat('#d4cabd', .92, 0, 22);
    const steel = RM.mat('#52636f', .48, .65, 29);
    const green = RM.mat('#15745f', .46, .04, 20, .06);
    const white = RM.mat('#f4f3e8', .42, .04, 20, .16);
    const local = (f, d, y, along = 0) => [f.x + f.rx * d + f.tx * along, f.y + y, f.z + f.rz * d + f.tz * along];
    const yaw = f => Math.atan2(-f.rz, f.rx);
    const signYellow = RM.mat('#ffca22', .48, .05, 20, .12);
    const signBlack = RM.mat('#101315', .6, .05, 20);
    // [里程, 箭頭方向 (+1 右 / -1 左 / 0 往上 = 前方飛越), 底色, 箭頭色]
    const signs = [[86, 1, green, white], [spiral.start - 16, 1, green, white],
      [cliff.start - 128, 0, signYellow, signBlack], [cliff.start - 52, 0, signYellow, signBlack],
      [valleyTurn - 250, 1, signYellow, signBlack], [valleyTurn - 150, 1, signYellow, signBlack], [valleyTurn - 50, 1, signYellow, signBlack]];
    for (const [s, turn, backing, ink] of signs) {
      const f = road.frameAt(s, {}), onDeck = road.bridge[f.i];
      const width = f.W + (onDeck ? .85 : 1.9);
      for (const side of [-1, 1]) {
        const p = local(f, side * width, 0);
        const bottom = onDeck ? f.y - .4 : road.hm.sample(p[0], p[2]);
        const top = f.y + 7.8;
        stage.box(p[0], (bottom + top) / 2, p[2], .46, top - bottom, .55, yaw(f), steel);
      }
      stage.box(f.x, f.y + 7.8, f.z, width * 2 + .5, .55, .6, yaw(f), steel);
      const warning = ink === signBlack;
      const panelWidth = warning ? width * 1.86 : 7.6;
      const panelHeight = warning ? 2.18 : 1.65, panelY = 7.5 - panelHeight * .5;
      stage.box(f.x, f.y + panelY, f.z, panelWidth, panelHeight, .36, yaw(f), backing);
      signFinish(stage, (u, v, depth) => local(f, (u - .5) * panelWidth, panelY + (v - .5) * panelHeight, -.19 - depth), panelWidth, panelHeight);
      const count = warning ? 5 : 3;
      for (let i = 0; i < count; i++) {
        const cell = (u, v) => local(f, ((i + u) / count - .5) * panelWidth, panelY + (v - .5) * panelHeight, -.21);
        // 箭頭原本朝右；朝左就左右鏡射，朝上就轉 90°。
        const point = turn > 0 ? cell : turn < 0 ? (u, v) => cell(1 - u, v) : (u, v) => cell(.5 + (.5 - v) * .62, u);
        drawChevron(stage, point, ink);
      }
    }

    // 立柱置於環內側，避開各層柏油路與進出匝道。
    for (let s = spiral.start + 39; s < spiral.start + spiral.lapLength; s += 44) {
      const f = road.frameAt(s, {});
      const [x, top, z] = local(f, f.W + 4, -1.16);
      const bottom = road.hm.sample(x, z);
      let clear = true;
      for (let i = 0; i < road.N; i += 2) {
        if (Math.hypot(road.px[i] - x, road.pz[i] - z) > road.halfW[i] + 2.6) continue;
        clear = false; break;
      }
      if (!clear) continue;
      stage.box(x, (bottom + top) / 2, z, 2.25, top - bottom, 2.6, yaw(f), concrete);
      for (let level = s; level < spiral.end - 15; level += spiral.lapLength) {
        const deck = road.frameAt(level, {});
        const p = local(deck, deck.W * .48, -1.48);
        stage.box(...p, deck.W * 1.1 + 8.8, .85, 2.6, yaw(deck), concrete);
      }
    }
    const deck = s => {
      const f = road.frameAt(s, {}), edge = f.W + .52;
      return { left: local(f, -edge, -.16), right: local(f, edge, -.16),
        lowerLeft: local(f, -edge, -1.16), lowerRight: local(f, edge, -1.16) };
    };
    for (const [from, to] of decks) {
      let a = deck(from);
      for (let s = from + spacing; s <= to; s += spacing) {
        const b = deck(s);
        stage.quad(a.left, b.left, b.lowerLeft, a.lowerLeft, concrete);
        stage.quad(b.right, a.right, a.lowerRight, b.lowerRight, concrete);
        stage.quad(a.lowerLeft, b.lowerLeft, b.lowerRight, a.lowerRight, concrete);
        a = b;
      }
    }
  }

  // 斷崖兩岸：斷橋的斷面、橋墩，以及對岸橋頭的黃黑警示帶 (飛在空中時看得到落點的邊緣)。
  function buildCliff(stage, road) {
    const concrete = RM.mat('#d4cabd', .92, 0, 22), dark = RM.mat('#9c8f80', .95, 0, 22);
    const yellow = RM.mat('#ffca22', .68, 0, 0, .3), black = RM.mat('#101315', .86);
    const yaw = f => Math.atan2(-f.rz, f.rx);
    for (const [lip, back] of [[cliff.start, -1], [cliff.end, 1]]) {
      const f = road.frameAt(lip, {}), edge = f.W + .52;
      // 斷面沿路面橫坡分成數片；back = +1 是對岸 (面向來車)。
      const face = (u, y) => {
        const d = (u * 2 - 1) * edge;
        return [f.x + f.rx * d, f.y + road.surfOff(f.i, f.t, RM.clamp(d, -f.W, f.W)) + y, f.z + f.rz * d];
      };
      const panels = 12, bandTop = -.02, bandBottom = back > 0 ? -1.5 : -1.16;
      for (let i = 0; i < panels; i++) {
        const u0 = i / panels, u1 = (i + 1) / panels;
        const material = back > 0 ? (i % 2 ? black : yellow) : concrete;
        const quad = [face(u0, bandBottom), face(u1, bandBottom), face(u1, bandTop), face(u0, bandTop)];
        if (back > 0) quad.reverse();
        stage.quad(...quad, material);
      }
      // 橋墩：離斷口 8 m，從橋面底下立到溪谷邊坡。
      const p = road.frameAt(lip + back * 8, {});
      const bottom = road.hm.sample(p.x, p.z) - .6, top = p.y - 1.16;
      stage.box(p.x, (bottom + top) / 2, p.z, p.W * 1.5, top - bottom, 2.2, yaw(p), concrete);
      stage.box(p.x, top - .45, p.z, p.W * 2 + 1.04, .9, 2.8, yaw(p), concrete);
      // 橋台：橋面接回路堤的地方。
      const q = road.frameAt(lip + back * cliff.deck, {});
      const base = road.hm.sample(q.x, q.z) - 1.2, cap = q.y - .6;
      stage.box(q.x, (base + cap) / 2, q.z, q.W * 2 + 1.04, cap - base, 1.6, yaw(q), dark);
    }
  }

  function build() {
    const theme = RM.DriftTheme.setup({ points, spacing, finish: section.s1 });
    const stage = new RM.MeshBuilder();
    const ground = buildGround(stage, theme);
    const road = new RM.Road(data, ground);
    const barrier = RM.mat('#d7d4c9', .9, 0, 21);
    const cap = RM.mat('#e2e0d5', .8, 0, 22), reflector = RM.mat('#ffc84d', .35, .12, 20, .16);
    // 以連續低牆標示車輛碰撞邊界 (斷崖的缺口不畫)。
    for (const dir of [-1, 1]) {
      const edge = i => {
        const d = road.wall[dir > 0 ? 1 : 0][i];
        const f = road.pointAt(i * spacing, dir * road.halfW[i], {});
        return { p: [f.x + f.rx * d * dir, f.py, f.z + f.rz * d * dir], rx: f.rx * dir, rz: f.rz * dir };
      };
      let a = edge(0);
      for (let i = 1; i < count; i++) {
        const b = edge(i);
        if (!(road.hole && road.hole[i - 1])) {
          const p = (e, y, out = 0) => [e.p[0] + e.rx * out, e.p[1] + y, e.p[2] + e.rz * out];
          stage.quad(p(a, 0), p(b, 0), p(b, .57), p(a, .57), barrier, [(i - 1) * spacing, .57, i * spacing, 0]);
          stage.quad(p(a, .57), p(b, .57), p(b, .63, .06), p(a, .63, .06), cap);
          stage.quad(p(a, .63, .06), p(b, .63, .06), p(b, .63, .25), p(a, .63, .25), cap);
          if (i % 8 === 0) {
            const f = road.frameAt(i * spacing, {});
            stage.box(...p(b, .45, -.018), .055, .12, .25, Math.atan2(f.tx, f.tz), reflector);
          }
        }
        a = b;
      }
    }
    // 起終點和分段線使用同一網格。
    const split = RM.mat('#afc9db', .8, 0, 0, .12);
    const white = RM.mat('#f1f2ed', .8, 0, 0, .18);
    const dark = RM.mat('#24272a', .8);
    const amber = RM.mat('#dfaf58', .8, 0, 0, .13);
    function paintLine(s, depth, rows, colors) {
      const width = road.frameAt(s, {}).W - .45;
      const p = (s, d) => {
        const f = road.pointAt(s, d, {});
        return [f.px, f.py + .06, f.pz];
      };
      // 跨路拱時分成數段，避免標線交疊或沉到柏油下。
      for (let row = 0; row < rows; row++) for (let i = 0; i < 12; i++) {
        const tex = colors[(i + row) % colors.length];
        if (!tex) continue;
        const from = s + row * depth, to = from + depth;
        const a = -width + 2 * width * i / 12, b = -width + 2 * width * (i + 1) / 12;
        stage.quad(p(from, a), p(from, b), p(to, b), p(to, a), tex);
      }
    }
    paintLine(section.s0, .55, 1, [white]);
    paintLine(section.s1, .72, 2, [white, dark]);
    for (const cp of section.cps) paintLine(cp.s, .26, 1, [split, null]);
    const warnings = [cliff.start - 70, cliff.start - 44, cliff.start - 22, valleyTurn - 250, valleyTurn - 200, valleyTurn - 150, valleyTurn - 100, valleyTurn - 50, crestStart + 24];
    for (const warning of warnings) paintLine(warning, .35, 1, [amber, null]);
    paintLine(cliff.start - 2.4, .8, 2, [amber, dark]);
    buildHighway(stage, road);
    buildCliff(stage, road);
    buildTurnWarnings(stage, road);
    theme.decorate(stage, road, ground, { cliff, finish: section.s1, humpStart: humpA[0], townStart: hairpinStart, townEnd: crestStart });
    return { road, tiles: stage.buildTiles(256), roadMesh: road.buildChunkMesh(0, road.N - 1), water: theme.water(ground), theme };
  }

  // env：這張圖固定用的天空 / 光線 (renderer.js 的 ENV)
  RM.DriftTrack = { id: 'drift', section, data, build, env: 'miami' };
})();
