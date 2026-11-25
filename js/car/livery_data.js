'use strict';
// Original racing and custom liveries: clubsport, tribal, pinstriping and full-body themes.
// Preserve IDs and tiers: existing purchases continue to equip the redesigned art.
// #272d31 is adaptive ink; fixed ink inside ivory number discs uses #20262a.
(function () {
  const RM = window.RM, ink = '#272d31', fixed = '#20262a', ivory = '#e8e9e2';
  const path = (d, c) => `<path d="${d}" fill="${c}"/>`;
  const line = (d, c, w = 2) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const rect = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  const circle = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  const text = (s, x, y, size, color = ink, weight = 700, spacing = 0, italic = false) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" font-style="${italic ? 'italic' : 'normal'}" letter-spacing="${spacing}" fill="${color}">${s}</text>`;
  const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const flower = (x, y, r, a) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${r / 34})">${Array.from({ length: 5 }, (_, i) => `<g transform="rotate(${i * 72})">${path('M0 -3C-10 -11 -15 -25 -7 -34L0 -29L7 -34C15 -25 10 -11 0 -3Z', '#bd8495')}</g>`).join('')}${circle(0, 0, 3, '#e2c7a3')}</g>`;
  const pinstripe = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale})">`
    + path('M0 -176L9 -139L0 -111L-9 -139ZM0 142L7 178L0 213L-7 178Z', '#ba6848')
    + [-1, 1].map(s => `<g transform="scale(${s} 1)">`
      + line('M0 -137C-18 -83 -109 -107 -135 -57C-170 7 -56 19 -30 68C-19 90 -23 133 -4 165', ink, 5)
      + line('M-5 -102C-44 -57 -135 -83 -119 -25C-107 16 -41 23 -17 89', '#ba6848', 3)
      + line('M-7 -69C-37 -15 -79 -25 -67 10C-55 41 -9 23 -3 62', ink, 3)
      + line('M-161 -30C-155 42 -102 43 -66 76C-38 100 -49 127 -22 150', '#ba6848', 2)
      + path('M-135 -57L-157 -83L-146 -32Z', ink) + '</g>').join('')
    + line('M0 -108V129', ink, 2) + '</g>';
  const designs = [
    {
      id: 'lv_twin', tier: 1, name: 'Club Sport｜雙線', style: 'CLUB SPORT', palette: [ink, '#b83c3c'],
      desc: '車門下緣的 Club Sport 字標與細雙線，搭配偏置引擎蓋線條。大面積保留原車漆，走原廠競技套件的路線。',
      art: () => line('M458 255H568M916 255H1118', ink, 9) + line('M458 270H1118', ink, 2) + rect(1083, 249, 35, 11, '#b83c3c'),
      labels: [['club sport', 740, 267, 44, ink, 800, -1, true]],
      top: () => rect(174, 55, 13, 400, ink) + rect(198, 55, 3, 400, '#b83c3c') + text('CS', 190, 507, 22, ink, 800, 1),
    },
    {
      id: 'lv_slash', tier: 1, name: 'Apex｜赤刃圖騰', style: 'TRIBAL ATTACK', palette: [fixed, '#c32e36', ivory],
      desc: '紅黑刀鋒從前葉子板拉向車尾，分叉尖端與白色反向細線形成速度感。引擎蓋、車頂同樣以對稱圖騰呼應。',
      art: () => path('M70 278C380 270 630 162 902 144L1265 42L1135 125L1530 68L1302 174L1545 170L1282 255C1040 306 920 263 766 270L956 207C690 214 398 318 70 278Z', fixed)
        + path('M200 281C497 254 623 190 919 164L1215 73L1111 150L1442 101L1230 199L1406 188L1259 229C1070 278 998 251 887 251L1035 194C801 175 460 300 200 281Z', '#c32e36')
        + path('M915 202L1117 142L1041 193L1263 146L1128 216L1245 208L1125 238L1049 232L1137 198L958 232Z', ivory)
        + line('M88 298C473 307 654 226 833 217M1254 264L1496 207', '#c32e36', 3),
      labels: [['APEX', 761, 244, 43, ivory, 900, -1, true]],
      top: () => [-1, 1].map(s => `<g transform="translate(320 0) scale(${s} 1)">`
        + path('M-277 38C-234 188 -70 277 -41 448L-95 356L-68 530L-157 387L-182 493C-241 304 -236 222 -277 38Z', fixed)
        + path('M-259 77C-194 241 -101 274 -65 408L-125 332L-103 453L-184 349L-182 415C-223 289 -215 223 -259 77Z', '#c32e36')
        + line('M-239 113C-196 222 -111 310 -112 358M-163 387L-150 419', ivory, 4)
        + path('M-235 745L-77 933L-123 882L-92 1029L-191 902L-211 1009Z', fixed)
        + path('M-224 784L-131 892L-119 958L-181 880L-204 957Z', '#c32e36') + '</g>').join(''),
    },
    {
      id: 'lv_checker', tier: 1, name: 'Grid｜格旗流線', style: 'GRID FLOW', palette: [ink, '#a0c23c'],
      desc: '格旗沿車側曲線由細到寬展開，酸橙色輪廓線收束到車尾。圖案跨過葉子板與車門，引擎蓋有對應的偏置格旗。',
      art: () => {
        let checks = '';
        for (let r = 0; r < 9; r++) for (let c = 0; c < 40; c++) if ((r + c) % 2 === 0) checks += rect(c * 43 - r * 9, r * 40, 43, 40, ink);
        return '<defs><clipPath id="gridFlow"><path d="M40 271C590 283 767 179 1138 95L1580 24V162C1295 157 1092 234 856 279C510 347 305 300 40 285Z"/></clipPath></defs>'
          + `<g clip-path="url(#gridFlow)">${checks}</g>` + line('M47 291C587 328 851 243 1118 195S1411 158 1573 171', '#a0c23c', 5);
      },
      labels: [['GRID', 724, 155, 42, ink, 800, 7]],
      top: () => {
        let checks = '';
        for (let r = 0; r < 12; r++) for (let c = 0; c < 5; c++) if ((r + c) % 2 === 0) checks += rect(107 + c * 35 + r * 7, 30 + r * 35, 35, 35, ink);
        return checks + line('M296 35L388 455', '#a0c23c', 5);
      },
    },
    {
      id: 'lv_flame', tier: 2, name: 'Ember｜美式拉線', style: 'HAND LINED', palette: [ink, '#ba6848'],
      desc: '美式手工拉線風格：側面是交錯回旋的長線與尖端，車頭及車尾用對稱的針筆圖騰收尾。以線條本身構成全車主題。',
      art: () => line('M82 253C447 300 782 104 1127 119C1290 125 1337 191 1510 118C1358 234 1281 139 1114 155C843 181 522 315 243 279', ink, 9)
        + line('M119 265C439 310 774 138 1109 134C1282 130 1315 219 1478 154', '#ba6848', 3)
        + line('M268 237C492 283 635 199 733 207C851 220 968 106 1060 68C1010 146 941 171 871 185C1116 155 1185 198 1253 219', ink, 3)
        + line('M383 295C671 319 898 204 1131 215C1224 218 1300 267 1423 217M1112 153C1185 157 1227 244 1341 255', '#ba6848', 2)
        + path('M82 253L175 246L130 262ZM1510 118L1465 159L1475 134ZM1060 68L1040 118L1036 98Z', '#ba6848'),
      labels: [['EMBER', 713, 130, 31, ink, 700, 6]],
      top: () => pinstripe(320, 260, 1.02) + pinstripe(320, 1340, .66),
    },
    {
      id: 'lv_sponsor', tier: 2, name: 'Works｜競技', style: 'WORKS / 27', palette: [ink, '#b83c3c'],
      desc: '車門上的 27 號為主角，配上小型 WORKS 車隊字標與兩筆紅色技術標記。沒有大底色，也不堆疊贊助貼紙。',
      art: () => line('M680 104H658V222H680M840 104H862V222H840', ink, 2) + rect(681, 94, 31, 7, '#b83c3c')
        + line('M466 275H1056', ink, 3) + rect(1019, 270, 37, 9, '#b83c3c'),
      labels: [['27', 757, 211, 113, ink, 800, -5, true], ['BEIYI WORKS', 770, 258, 23, ink, 800, 3], ['APEX LAB', 445, 191, 14, ink, 700, 1]],
      top: () => text('27', 445, 330, 91, ink, 800, -4, true) + rect(404, 352, 76, 6, '#b83c3c'),
      banner: 'BEIYI WORKS',
    },
    {
      id: 'lv_touge', tier: 2, name: 'Touge｜墨嶺', style: 'SUMI / TOUGE', palette: [ink, '#b34d43'],
      desc: '墨色山稜跨過車門與後葉子板，朱紅日輪穿插在山勢之間。乾筆般的留白、細長山路與引擎蓋墨痕，組成完整的山道主題。',
      art: () => circle(1188, 107, 73, '#b34d43')
        + path('M95 289L350 254L458 213L513 231L665 163L718 184L874 96L981 158L1118 48L1201 123L1279 97L1519 244L1383 226L1234 146L1206 154L1123 85L1064 146L1160 137L1023 208L930 188L875 136L804 184L858 169L737 227L673 194L540 254L477 243L319 281Z', ink)
        + path('M343 305L590 267L747 247L921 209L1031 215L1244 168L1178 202L1440 227L1218 224L1025 251L906 244L709 282L536 278ZM139 298L395 283L300 307ZM728 296L913 265L1015 270L872 294Z', ink)
        + line('M345 315C653 295 756 230 953 239S1170 191 1338 208', '#b34d43', 4),
      labels: [['TOUGE', 706, 118, 36, ink, 800, 7], ['山 道', 1123, 292, 21, '#b34d43', 700, 2]],
      top: () => circle(427, 231, 91, '#b34d43')
        + path('M119 472L185 308L259 278L325 128L373 174L448 47L479 218L420 149L384 236L335 178L286 326L229 343L167 468ZM196 464L270 367L337 276L369 293L427 213L456 236L416 308L360 325L283 400Z', ink)
        + line('M170 489C295 462 315 332 454 314', '#b34d43', 5),
    },
    {
      id: 'lv_nine', tier: 2, name: 'Heritage｜09', style: 'HERITAGE / 09', palette: [ink, ivory],
      desc: '經典賽車圓形號碼牌與低位雙線。09 號集中在車門中央，其他鈑件保留原車漆，適合復古與現代車款。',
      art: () => circle(761, 164, 81, ink) + circle(761, 164, 78, ivory)
        + line('M466 277H1090M466 285H1090', ink, 2),
      labels: [['09', 761, 199, 106, fixed, 700, -5], ['NINE MOTOR CLUB', 771, 264, 17, ink, 700, 2]],
      top: () => line('M190 67V455M202 67V455', ink, 3),
    },
    {
      id: 'lv_hawaii', tier: 2, name: 'Coast｜浪潮', style: 'RETRO SURF', palette: ['#287f89', '#74b4b2', '#d39b61'],
      desc: '復古海岸賽車的三色曲線，從低位車頭向後肩上揚。深海藍、淺青與砂金循同一道弧線展開，車頭延續偏置浪形線條。',
      art: () => line('M55 281C387 315 671 300 887 213S1204 52 1567 75', ink, 72)
        + line('M55 281C387 315 671 300 887 213S1204 52 1567 75', '#287f89', 60)
        + line('M56 265C385 299 665 283 879 197S1201 36 1568 59', '#74b4b2', 13)
        + line('M55 298C390 332 677 317 895 230S1209 69 1566 92', '#d39b61', 11)
        + line('M80 235C371 270 674 258 861 176S1191 9 1537 30', '#d39b61', 3),
      labels: [['coast runner', 718, 198, 43, ink, 800, -1, true]],
      top: () => line('M103 0C133 130 272 156 245 285S148 420 167 555', ink, 65)
        + line('M103 0C133 130 272 156 245 285S148 420 167 555', '#287f89', 54)
        + line('M88 0C117 130 255 156 229 285S132 420 151 555', '#74b4b2', 12)
        + line('M119 0C149 130 288 156 261 285S164 420 183 555', '#d39b61', 9)
        + text('COAST', 426, 345, 28, ink, 700, 5),
    },
    {
      id: 'lv_team', tier: 3, name: 'MK｜廠隊', style: 'MK CLUB RACING', palette: [ink, '#bd9757'],
      desc: '以一枚俐落 MK 車隊字標作為主視覺，88 號與香檳金細節分布在前葉子板及側裙。引擎蓋保留車漆，只留下偏置識別。',
      art: () => path('M428 88H454L479 122H453Z', '#bd9757') + line('M470 278H1105', ink, 4)
        + path('M1103 122L1140 64H1153L1116 122ZM1125 122L1162 64H1167L1130 122Z', ink),
      labels: [['MK', 771, 219, 137, ink, 900, -6, true], ['CLUB RACING', 771, 251, 17, ink, 700, 6], ['88', 455, 171, 47, ink, 800, -2, true]],
      top: () => text('MK', 442, 321, 101, ink, 900, -4, true) + rect(401, 341, 88, 5, '#bd9757'),
      banner: 'MK CLUB RACING',
    },
    {
      id: 'lv_sakura', tier: 3, name: 'Yozakura｜夜櫻', style: 'NIGHT BLOOM', palette: [ink, '#bd8495', '#e2c7a3'],
      desc: '夜櫻沿墨色長枝從車頭向車尾綻放，花瓣疏密交錯，帶出後肩的張力。引擎蓋有另一枝斜向花影，淡金拉線貫穿整車。',
      art: () => path('M67 281C501 311 796 210 1096 161L1415 34L1321 92L1545 80L1374 111L1221 148L1096 184C809 216 525 333 67 281Z', ink)
        + path('M931 211L1011 128L992 75L1027 128L982 196ZM1112 168L1196 225L1282 240L1191 245L1063 188ZM1242 126L1279 52L1333 19L1301 60L1280 112Z', ink)
        + line('M128 305C650 325 907 203 1166 196S1392 157 1531 118', '#e2c7a3', 3)
        + [[811,220,30,-12],[1010,123,42,17],[1109,176,35,-4],[1196,231,42,27],[1274,92,48,0],[1390,79,31,15],[1482,131,23,9]].map(p => flower(...p)).join('')
        + path('M655 248Q633 214 653 216Q673 226 655 248ZM936 66Q916 44 933 40Q952 47 936 66ZM1358 209Q1341 179 1361 179Q1378 194 1358 209Z', '#bd8495'),
      labels: [['YOZAKURA', 716, 170, 30, ink, 700, 5]],
      top: () => path('M62 544C183 336 381 244 533 44L497 131L553 114L492 155L402 252L474 257L530 235L485 274L379 278L258 386L277 307L224 413Z', ink)
        + [[176,399,42,15],[310,325,57,28],[403,248,49,2],[499,151,36,12],[502,270,30,18]].map(p => flower(...p)).join('')
        + line('M77 533C139 346 364 263 509 62', '#e2c7a3', 3)
        + flower(408,1307,46,13) + line('M263 1459L426 1260L475 1211', ink, 6),
    },
  ];

  const stickers = {}, sets = [];
  for (const d of designs) {
    const side = right => svg(1600, 320, `<g${right ? ' transform="translate(1600 0) scale(-1 1)"' : ''}>${d.art()}</g>`
      + d.labels.map(([s, x, y, size, color, weight, spacing, italic]) => text(s, right ? 1600 - x : x, y, size, color, weight, spacing, italic)).join(''));
    stickers[d.id + '_left'] = { aspect: 5, svg: side(false) };
    stickers[d.id + '_right'] = { aspect: 5, svg: side(true) };
    stickers[d.id + '_top'] = { aspect: .4, svg: svg(640, 1600, d.top()) };
    const items = [
      { sticker: d.id + '_left', rightSticker: d.id + '_right', zone: 'side', x: .5, y: .62, w: .98 },
      { sticker: d.id + '_top', zone: 'top', x: 0, y: .5, w: 1, h: 1 },
    ];
    if (d.banner) {
      // A small white wordmark on the existing glass, not an opaque sunstrip.
      stickers[d.id + '_banner'] = { aspect: 20, svg: svg(1280, 64, text(d.banner, 640, 40, 25, '#d6dad8', 700, 4)) };
      items.push({ sticker: d.id + '_banner', zone: 'windshield', w: .9 });
    }
    sets.push({ id: d.id, tier: d.tier, name: d.name, style: d.style, desc: d.desc, palette: d.palette, preview: d.id + '_left', items });
  }
  RM.LiveryData = { stickers, sets, adaptiveInk: ink, lightInk: '#d6dad8' };
})();
