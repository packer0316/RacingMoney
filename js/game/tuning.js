'use strict';
// 改裝系統：零件目錄、性能換算、每台車裝了什麼
//
//   錢：籌碼。平台上用紅鑽兌換 (1 紅鑽 = 100 籌碼，goldsaucer.json 的 currency.perDiamond)，買零件時由伺服器函式扣
//       (server/functions.js buyMod 回傳 chips: { bet: 價格 })；沒花完的籌碼離開遊戲時平台會自動換回紅鑽。
//   共用零件 (輪圈、輪胎、避震、卡鉗、排氣管、彩繪)：買一次，每台車都能裝；每台車各自選要裝哪一個 (fit)。
//   寫電腦 (ECU 1～3 階)：每台車各自買，要依序升級；調校方向 (均衡 / 極速 / 起步 / 甩尾) 免費切換 (fit.ecuC)。
//   價格與 id 要和 server/functions.js 的 MODS 一致 (伺服器說了算)。
//
// 性能設計 (2026-11-25 重新設計)：零件都是「複合式」的，同一個部位的零件各有個性，不是越貴越強。
//   每個零件會動到好幾項性能，有些還有代價 (三片式深唇圈甩尾最強但比較重、直通排氣高轉猛但起步變軟、半熱熔胎抓地最強但不好甩)；
//   特定零件裝在一起還有「搭配加成」(COMBOS)。性能評級 (ratingBonus) 的權重是用 Node 直接跑車輛物理量出來的
//   (彎道衝刺自動駕駛的單圈時間 + 平地加速 / 極速)，見 README「改裝工廠」。
//
// 外觀見 js/car/tuning_vis.js；性能在 startRace 建立車輛前套用 (applySpec)。
(function () {
  const RM = window.RM;

  const SLOTS = [
    { id: 'wheel', name: '輪圈', icon: '◎' },
    { id: 'tire', name: '輪胎', icon: '◍' },
    { id: 'susp', name: '避震', icon: '⌇' },
    { id: 'brake', name: '卡鉗', icon: '◐' },
    { id: 'exhaust', name: '排氣管', icon: '◉' },
    { id: 'ecu', name: '寫電腦', icon: '⚡' },
    { id: 'livery', name: '彩繪', icon: '✦' },
  ];

  // 顏色 [名稱, 色碼, 粗糙度, 金屬度]
  const F = (name, hex, rough, metal) => ({ name, hex, rough, metal });
  const FIN = {
    cast: [F('亮銀', '#a9adb3', 0.35, 0.6), F('槍灰', '#44484e', 0.4, 0.5), F('切削雙色', '#d5d8dc', 0.15, 1)],
    flow: [F('競技銀', '#c4c7cb', 0.3, 0.7), F('香檳金', '#c9a042', 0.3, 0.85), F('霧銅', '#7d6036', 0.55, 0.8), F('純白', '#ededea', 0.4, 0), F('霧黑', '#1c1c1e', 0.7, 0.2)],
    forged: [F('陽極青銅', '#8c6a3c', 0.35, 0.9), F('純白', '#f1f1ec', 0.45, 0), F('金屬藍', '#2b4c96', 0.3, 0.6), F('深槍灰', '#35373b', 0.3, 0.8)],
    mesh: [F('金色', '#b8963e', 0.28, 0.85), F('鑽石銀', '#c9ccd0', 0.22, 0.9), F('亮黑', '#141416', 0.3, 0.3)],
    multi: [F('白色中心', '#f0f0eb', 0.4, 0), F('銀色中心', '#bfc3c8', 0.3, 0.8), F('霧黑中心', '#141416', 0.65, 0.2), F('金色中心', '#c8a24a', 0.3, 0.9)],
    caliper: [F('競技紅', '#c8102e', 0.25, 0.1), F('亮黃', '#ffd100', 0.25, 0.1), F('香檳金', '#c9a13b', 0.25, 0.8), F('賽道藍', '#1f4fb5', 0.25, 0.1), F('黑底白字', '#111111', 0.25, 0.1), F('螢光綠', '#d7e62b', 0.25, 0.1)],
    spring: [F('亮黃', '#f2c200', 0.35, 0.1), F('賽道藍', '#1e5bd8', 0.35, 0.1), F('競技紅', '#d2141e', 0.35, 0.1), F('紫色', '#6b2fa0', 0.35, 0.1), F('白色', '#f4f4f4', 0.35, 0.1)],
  };

  // ---- 性能效果 fx (每個零件可以同時有好幾項)
  //   乘法 (1 = 不變)：torque 扭力、wheelI 輪胎轉動慣量、launch 起步輔助推力、start 彈射起步推力、cd 風阻、nitro 氮氣推力、
  //                    mu 四輪抓地、muR 後輪抓地 (< 1 尾巴比較滑，好甩但平常過彎比較不穩)、wet 雨天抓地損失 (原本 28%)、
  //                    brake 煞車力、brakeR 後輪煞車再乘 (後輪煞車比加重)、stiff 懸吊硬度、
  //                    charge 甩尾集氣速度、boost 甩尾結束的小噴射、dDrag 甩尾中的減速 (< 1 甩尾比較不掉速)、loud 排氣聲量
  //   加法 (0 = 不變)：rev 紅線轉速、mass 車重 (kg)、lower 車身降低 (m)、camber 外傾角 (度，外觀)
  const MUL = ['torque', 'wheelI', 'launch', 'start', 'cd', 'nitro', 'mu', 'muR', 'wet', 'brake', 'brakeR', 'stiff', 'charge', 'boost', 'dDrag', 'loud'];
  const ADD = ['rev', 'mass', 'lower', 'camber'];

  // 零件：slot 部位、tier 等級 (1～3，只代表做工 / 價位，不代表比較強)、price 籌碼、fx 性能、vis 外觀參數 (tuning_vis.js)、fin 可選顏色 (買了之後免費換)
  const PARTS = {
    // ---- 輪圈：鑄造 = 大一吋配寬胎的穩定、旋壓 = 輕快、鍛造 = 最輕的加速王、網狀 = 通風煞車 + 甩尾噴射、深唇 = 甩尾最強但最重
    w_cast: { slot: 'wheel', tier: 1, price: 1500, name: '街道鑄造圈', sub: '鑄造 · 5 雙肋 · 大一吋', desc: '一體鑄造的粗壯五組雙肋。大一吋配更寬的輪胎，過彎抓地多一點、起步比較不空轉；重量和原廠差不多，便宜又實在。', fx: { mu: 1.02, launch: 1.05, mass: -2 }, vis: { style: 'cast', upsize: 1 }, fin: 'cast' },
    w_flow: { slot: 'wheel', tier: 2, price: 4000, name: '旋壓輕量圈', sub: '旋壓 · 6×2 細肋 · 輕快', desc: '輪輞以旋壓延展成形，比鑄造輕 10～15%。轉動慣量小，起步、出彎拉得快；甩尾時後輪轉速掉得少，甩尾比較不掉速。', fx: { wheelI: 0.92, mass: -8, launch: 1.12, dDrag: 0.97 }, vis: { style: 'flow', upsize: 1 }, fin: 'flow' },
    w_forged: { slot: 'wheel', tier: 3, price: 10000, name: '鍛造競技圈', sub: '單片鍛造 · 6 寬肋 · 最輕', desc: '整塊鋁胚鍛造切削，最輕也最剛，加速最好；簧下重量少，煞車和循跡也跟著變好。純競技取向，對甩尾沒有特別幫助。', fx: { wheelI: 0.88, mass: -12, launch: 1.2, mu: 1.03, brake: 1.05 }, vis: { style: 'forged', upsize: 2 }, fin: 'forged' },
    w_mesh: { slot: 'wheel', tier: 3, price: 12000, name: '網狀鍛造圈', sub: '兩片式鍛造 · 網狀 · 通風', desc: '經典交叉網狀輻條，通風最好、煞車不容易熱衰退；復古甩尾車的招牌，甩尾出彎的噴射更有力。', fx: { wheelI: 0.94, mass: -8, brake: 1.1, mu: 1.01, boost: 1.1, charge: 1.05 }, vis: { style: 'mesh', upsize: 2 }, fin: 'mesh' },
    w_deep: { slot: 'wheel', tier: 3, price: 14000, name: '三片式深唇圈', sub: '三片式鍛造 · 深唇 · 寬胎', desc: '鏡面深唇配最寬的輪胎：甩尾保速、集氣、出彎噴射都是輪圈裡最強，過彎也更穩。代價是三片式比原廠還重，起步會慢一點。', fx: { wheelI: 1.04, mass: 8, launch: 0.94, mu: 1.03, dDrag: 0.94, boost: 1.1, charge: 1.08 }, vis: { style: 'deep', upsize: 2 }, fin: 'multi' },

    // ---- 輪胎：運動胎 = 全能、雨胎 = 下雨專用、甩尾胎 = 尾巴滑好甩、半熱熔 = 乾地抓地王但不好甩、下雨很慘
    t_sport: { slot: 'tire', tier: 1, price: 2000, name: '高性能運動胎', sub: '街道全能 · 白字胎壁', desc: '大塊胎肩、三道排水溝，乾地、雨天都比原廠好一點，起步也比較不會空轉。', fx: { mu: 1.04, launch: 1.08, wet: 0.85 }, vis: { tread: 'sport', letters: true } },
    t_rain: { slot: 'tire', tier: 2, price: 2500, name: '全天候雨胎', sub: '深排水溝 · 雨天專用', desc: '密集的深排水溝配軟質膠料，下雨幾乎不掉抓地；晴天只比原廠好一點點。雨天出賽的祕密武器。', fx: { wet: 0.4, mu: 1.01 }, vis: { tread: '', letters: false } },
    t_drift: { slot: 'tire', tier: 2, price: 4000, name: '甩尾專用胎', sub: '硬質胎面 · 好甩不掉速', desc: '硬質胎面，甩尾時輪胎不會黏住路面：甩尾中不容易掉速、集氣快、出彎噴射有力。代價是硬胎抓地差一點，起步也比較容易空轉。', fx: { dDrag: 0.9, charge: 1.1, boost: 1.03, mu: 0.98, launch: 0.92 }, vis: { tread: 'sport', letters: true } },
    t_semi: { slot: 'tire', tier: 3, price: 7000, name: '半熱熔競技胎', sub: '半熱熔 · R 規 · 乾地抓地王', desc: '幾乎沒有花紋的熱熔胎面，乾地抓地最強、起步不空轉；抓得太緊反而不好甩 (集氣變慢)，下雨排水差更是大扣分。', fx: { mu: 1.1, launch: 1.1, charge: 0.9, dDrag: 1.04, wet: 1.5 }, vis: { tread: 'semi', letters: true } },

    // ---- 避震：短彈簧 = 便宜的小全面、可調避震 = 甩尾設定、競技避震 = 抓地設定 (太硬不好甩)。外觀：車身降低、輪胎外傾
    s_spring: { slot: 'susp', tier: 1, price: 2000, name: '短彈簧', sub: '降低 2.5 cm · 小幅全面', desc: '換短彈簧降低車身：輪拱縫變小、側傾少一點，車身低風阻也小一點。', fx: { lower: 0.025, stiff: 1.08, camber: 1, mu: 1.01, cd: 0.98 }, vis: { coil: false } },
    s_street: { slot: 'susp', tier: 2, price: 5500, name: '街道高低軟硬可調避震', sub: '降低 3.5 cm · 甩尾設定', desc: '螺牙式高低可調，阻尼調成前硬後軟的甩尾設定：甩尾好起、好控制、不掉速；抓地過彎只比原廠好一點。', fx: { lower: 0.035, stiff: 1.15, camber: 2, mu: 1.01, dDrag: 0.94, charge: 1.05, boost: 1.03, cd: 0.98 }, vis: { coil: true }, fin: 'spring' },
    s_race: { slot: 'susp', tier: 3, price: 12500, name: '競技避震器', sub: '降低 5 cm · 抓地設定', desc: '賽道用硬避震加負外傾，過彎幾乎不側傾、抓地最好、風阻最小；太硬太黏，甩尾集氣會慢一些。', fx: { lower: 0.05, stiff: 1.4, camber: 3, mu: 1.05, cd: 0.97, charge: 0.95, dDrag: 1.03 }, vis: { coil: true }, fin: 'spring' },

    // ---- 卡鉗：四活塞 = 輕量、六活塞 = 後輪煞車加重好甩、浮動碟 = 最強制動。外觀：卡鉗變大、上色，碟盤打孔 / 劃線 / 浮動碟
    b_4pot: { slot: 'brake', tier: 1, price: 2500, name: '四活塞卡鉗', sub: '330 mm 碟 · 輕量鋁合金', desc: '鋁合金對向四活塞卡鉗，比原廠的鑄鐵卡鉗輕 4 kg，煞車力 +12% (原廠煞車偏弱的車最有感)。便宜的輕量化零件。', fx: { brake: 1.12, mass: -4 }, vis: { pistons: 2, disc: 0.165, size: 1, rotor: 'plain' }, fin: 'caliper' },
    b_6pot: { slot: 'brake', tier: 2, price: 6500, name: '六活塞卡鉗', sub: '355 mm 打孔碟 · 後輪加強', desc: '六活塞配打孔碟，煞車力 +20%，而且後輪煞車比加重：入彎點一下煞車就能把車尾帶出去，甩尾更好起。', fx: { brake: 1.2, brakeR: 1.15, boost: 1.06, charge: 1.06 }, vis: { pistons: 3, disc: 0.178, size: 1.18, rotor: 'drilled' }, fin: 'caliper' },
    b_race: { slot: 'brake', tier: 3, price: 13500, name: '競技六活塞 + 浮動碟', sub: '380 mm 兩片式浮動碟', desc: '賽道規格，煞車力 +38% 而且不衰退，可以最晚煞車；兩片式浮動碟比同尺寸的一體碟輕。', fx: { brake: 1.38, mass: -4, wheelI: 0.96 }, vis: { pistons: 3, disc: 0.19, size: 1.3, rotor: 'float' }, fin: 'caliper' },

    // ---- 排氣管：不鏽鋼 = 低轉扭力、鈦合金 = 最輕、直通 = 高轉 + 氮氣但起步軟。外觀：尾管變大，鈦合金有燒藍漸層
    e_ss: { slot: 'exhaust', tier: 1, price: 2000, name: '不鏽鋼排氣管', sub: '低轉扭力 · 亮面捲邊', desc: '保留適當背壓，低轉扭力最飽滿：起步和出彎最有感，輕 5 kg，聲浪厚實。', fx: { torque: 1.02, launch: 1.1, mass: -5, loud: 1.25 }, vis: { tip: 'steel', r: 0.05 } },
    e_ti: { slot: 'exhaust', tier: 2, price: 7000, name: '鈦合金排氣管', sub: '最輕 · 燒藍鈦尾管', desc: '全段鈦合金，重量只有原廠的三分之一 (輕 14 kg)：車尾變輕，加速、過彎都受惠；排氣順暢，動力 +5%、紅線多 200 轉。', fx: { torque: 1.05, rev: 200, mass: -14, loud: 1.5 }, vis: { tip: 'ti', r: 0.057 } },
    e_race: { slot: 'exhaust', tier: 3, price: 12500, name: '直通競技排氣', sub: '高轉動力 · 氮氣強化', desc: '直通設計，高轉最猛 (動力 +6%、紅線多 200 轉)，氮氣也燒得更兇 (+10%)；但背壓太小，低轉起步反而變軟。', fx: { torque: 1.06, rev: 200, nitro: 1.1, launch: 0.8, start: 0.9, loud: 1.8 }, vis: { tip: 'carbon', r: 0.064 } },

    // ---- 寫電腦 (每台車各自買，依序升級)：階數決定改多少，調校方向 (ECU_MAPS) 決定往哪邊加
    ecu1: { slot: 'ecu', tier: 1, price: 3500, name: '一階 ECU', sub: '重寫點火 / 噴油', desc: '重寫點火正時與噴油量。下面選調校方向，買了之後可以免費切換。' },
    ecu2: { slot: 'ecu', tier: 2, price: 9000, name: '二階 ECU', sub: '加大增壓 / 進氣', desc: '提高增壓 / 進氣量並放寬限制，效果大約是一階的兩倍。調校方向免費切換。' },
    ecu3: { slot: 'ecu', tier: 3, price: 18000, name: '三階 ECU', sub: '競技全開', desc: '競技地圖全開，效果最大。調校方向免費切換。' },
  };

  // 寫電腦的調校方向 (fit.ecuC)：fx 依階數 [一階, 二階, 三階]
  const ECU_MAPS = [
    { name: '均衡', note: '扭力、紅線', fx: [{ torque: 1.08 }, { torque: 1.16, rev: 200 }, { torque: 1.26, rev: 400 }] },
    { name: '極速', note: '紅線、氮氣', fx: [{ torque: 1.06, rev: 200, nitro: 1.04 }, { torque: 1.12, rev: 400, nitro: 1.08 }, { torque: 1.19, rev: 600, nitro: 1.12 }] },
    { name: '起步', note: '起步、彈射', fx: [{ torque: 1.07, launch: 1.12, start: 1.1 }, { torque: 1.14, launch: 1.24, start: 1.2 }, { torque: 1.22, launch: 1.36, start: 1.3 }] },
    { name: '甩尾', note: '保速、噴射', fx: [{ torque: 1.05, dDrag: 0.97, boost: 1.04, charge: 1.05 }, { torque: 1.1, dDrag: 0.94, boost: 1.08, charge: 1.1 }, { torque: 1.15, dDrag: 0.91, boost: 1.12, charge: 1.15 }] },
  ];
  function ecuFx(tier, map) {
    tier = Math.max(0, Math.min(3, tier | 0));
    return tier ? (ECU_MAPS[map | 0] || ECU_MAPS[0]).fx[tier - 1] : null;
  }

  // 搭配加成：need 每一組裡裝了任一個就算 ('ecu:n' = 寫電腦至少一階、調校方向 n)
  const COMBOS = [
    { id: 'street', name: '街頭入門', need: [['w_cast'], ['t_sport'], ['s_spring'], ['e_ss']], fx: { torque: 1.02, mu: 1.01, dDrag: 0.98, charge: 1.04 }, desc: '四件入門零件到齊，整台車調性一致：動力、抓地、甩尾都再好一點。' },
    { id: 'touge', name: '峠道甩尾', need: [['t_drift'], ['s_street'], ['w_deep', 'w_mesh']], fx: { dDrag: 0.95, boost: 1.04, charge: 1.05 }, desc: '甩尾胎 + 甩尾設定的避震 + 寬胎甩尾圈：甩尾集氣、噴射、保速再提升。' },
    { id: 'circuit', name: '賽道抓地', need: [['t_semi'], ['s_race'], ['b_race']], fx: { mu: 1.02, brake: 1.05 }, desc: '半熱熔胎 + 競技避震 + 浮動碟的賽道組合：抓地、煞車再提升。' },
    { id: 'light', name: '輕量化', need: [['w_forged', 'w_flow'], ['e_ti'], ['b_4pot']], fx: { mass: -25, launch: 1.06 }, desc: '輕量輪圈 + 鈦合金排氣 + 鋁合金卡鉗：連螺絲、支架、電瓶都換輕的，再輕 25 kg。' },
    { id: 'top', name: '極速衝刺', need: [['e_race'], ['ecu:1']], fx: { nitro: 1.06, cd: 0.98 }, desc: '直通排氣配極速調校：氮氣更猛、風阻再小一點。' },
    { id: 'rain', name: '雨戰', need: [['t_rain'], ['b_6pot']], fx: { wet: 0.75, brake: 1.04 }, desc: '雨胎 + 打孔碟 (碟面不積水)：下雨時抓地、煞車再提升。' },
  ];

  // 彩繪 (純外觀)：貼紙組合見 js/car/livery_data.js (由 RM.LiveryData 註冊進來)
  const LIVERY_PRICE = { 1: 5000, 2: 5000, 3: 5000 };   // 彩繪統一 5,000 (等級只用來顯示星數)
  function liveries() { return (RM.LiveryData && RM.LiveryData.sets) || []; }
  function part(id) {
    if (PARTS[id]) return PARTS[id];
    const L = liveries().find((l) => l.id === id);
    return L ? { slot: 'livery', tier: L.tier, price: LIVERY_PRICE[L.tier] || 6000, name: L.name, sub: '彩繪 · 純外觀', desc: L.desc, fx: {}, livery: L } : null;
  }
  function partsOf(slot) {
    if (slot === 'livery') return liveries().map((l) => l.id);
    return Object.keys(PARTS).filter((id) => PARTS[id].slot === slot);
  }

  // ---- 玩家的改裝資料 (伺服器 state.mods)：{ own: { 零件 id: 1 }, ecu: { 車款: 階數 }, fit: { 車款: { wheel, wheelC, tire, susp, suspC, brake, brakeC, exhaust, livery, ecuC } } }
  const empty = () => ({ own: {}, ecu: {}, fit: {} });
  // 這台車實際裝了什麼 (沒買的不算，換回原廠)
  function fitOf(car, mods) {
    mods = mods || empty();
    const f = (mods.fit && mods.fit[car]) || {}, out = { ecu: Math.max(0, Math.min(3, (mods.ecu && mods.ecu[car]) | 0)) };
    out.ecuC = Math.max(0, Math.min(ECU_MAPS.length - 1, f.ecuC | 0));
    for (const s of SLOTS) {
      if (s.id === 'ecu') continue;
      const id = f[s.id];
      const p = id && part(id);
      out[s.id] = p && p.slot === s.id && mods.own && mods.own[id] ? id : null;
      out[s.id + 'C'] = (f[s.id + 'C'] | 0) || 0;
    }
    return out;
  }

  function blank() { const e = {}; for (const k of MUL) e[k] = 1; for (const k of ADD) e[k] = 0; return e; }
  function addFx(e, fx) {
    if (!fx) return;
    for (const k in fx) {
      if (MUL.includes(k)) e[k] *= fx[k];
      else if (ADD.includes(k)) e[k] += fx[k];
    }
  }
  // 這個 fit 有沒有裝 tok ('ecu:n' = 寫電腦至少一階、調校方向 n)
  function has(fit, tok) {
    if (tok.startsWith('ecu:')) return (fit.ecu | 0) >= 1 && (fit.ecuC | 0) === +tok.slice(4);
    const p = PARTS[tok];
    return !!p && fit[p.slot] === tok;
  }
  // 成立的搭配加成
  function combosOf(fit) { return fit ? COMBOS.filter((c) => c.need.every((g) => g.some((t) => has(fit, t)))) : []; }
  // 合併後的性能效果 (noCombo：不含搭配加成，用來算單一零件的效果)
  function effects(fit, noCombo) {
    const e = blank();
    if (!fit) return e;
    for (const s of SLOTS) if (s.id !== 'ecu' && s.id !== 'livery' && fit[s.id]) { const p = part(fit[s.id]); if (p) addFx(e, p.fx); }
    addFx(e, ecuFx(fit.ecu, fit.ecuC));
    if (!noCombo) for (const c of combosOf(fit)) addFx(e, c.fx);
    // 疊加上限：甩尾噴射、甩尾保速加太多會常常擦到彎道內側的牆 (Node 物理模擬量過)
    for (const k in CAP) e[k] = Math.max(CAP[k][0], Math.min(CAP[k][1], e[k]));
    return e;
  }
  const CAP = { boost: [0.8, 1.2], dDrag: [0.8, 1.2], charge: [0.8, 1.4], nitro: [0.8, 1.35] };
  // 套用到車輛規格 (makeSpec 之後；車輛建立之前)。S.lower：車身畫低多少 (重心跟著降，車身相對重心的位置不變)
  function applyEffects(S, e) {
    if (e.torque !== 1) S.torque = S.torque.map(([rpm, t]) => [rpm, t * e.torque]);
    // 紅線提高：扭力峰值之後的曲線跟著往高轉拉長 (高轉的動力帶變寬)。只加紅線不拉曲線的話，自排升檔點跟著往後延，
    // 會拖到扭力已經掉下去的轉速才換檔，反而變慢 (AE86 實測整圈慢好幾秒)
    if (e.rev) {
      const R = S.redline, pk = S.torque.reduce((b, p) => (p[1] > b[1] ? p : b), S.torque[0])[0];
      if (R > pk + 500) S.torque = S.torque.map(([rpm, t]) => [rpm > pk ? pk + (rpm - pk) * (R + e.rev - pk) / (R - pk) : rpm, t]);
      S.redline += e.rev; S.cut += e.rev;
    }
    if (e.mass) S.mass = Math.max(600, S.mass + e.mass);
    if (e.wheelI !== 1 && S.wheelI) S.wheelI = S.wheelI.map((v) => v * e.wheelI);
    if (e.launch !== 1 && S.launch) S.launch = [S.launch[0] * e.launch, S.launch[1], S.launch[2]];
    if (e.cd !== 1) S.cd *= e.cd;
    if (e.mu !== 1) S.mu *= e.mu;
    if (e.muR !== 1) S.muRear *= e.muR;
    S.wetK = (S.wetK || 0.28) * e.wet;
    if (e.brake !== 1 || e.brakeR !== 1) { S.brakeF *= e.brake; S.brakeR *= e.brake * e.brakeR; }
    if (e.stiff !== 1) for (const k of ['kSpring', 'cBump', 'cReb', 'arb']) if (S[k]) S[k] = S[k].map((v) => v * (k === 'cBump' || k === 'cReb' ? Math.sqrt(e.stiff) : e.stiff));
    // 甩尾 / 氮氣 (車款檔的 drift 是共用物件，先複製一份再改)
    if (S.drift && (e.charge !== 1 || e.boost !== 1 || e.dDrag !== 1 || e.nitro !== 1 || e.start !== 1)) {
      const d = S.drift = Object.assign({}, S.drift);
      d.charge *= e.charge; d.boost *= e.boost; d.drag *= e.dDrag; d.nitro *= e.nitro; d.start *= e.start;
    }
    // 降低：重心跟著車身降 (車身相對重心的位置不變，所以燈、排氣管、相機位置都不用動)；
    // 往上壓縮的行程少掉同樣的量 (緩衝塊相對車身的位置不變，輪胎才不會壓進葉子板)
    if (e.lower) { S.cgH -= e.lower; S.lower = e.lower; if (S.travelUp) S.travelUp = Math.max(0.025, S.travelUp - e.lower); }
    S.camber = e.camber;
    S.loud = e.loud;
    return S;
  }
  function applySpec(S, fit) {
    applyEffects(S, effects(fit));
    S.tuned = fit;
    return S;
  }

  // 車庫的性能評級 (menu.js：速度、加速度、飄移、操控性，滿分 10；原廠分數不變，改裝的加成是小數，可以是負的)
  // 權重：用 Node 跑車輛物理 (平地加速 / 極速、彎道衝刺自動駕駛單圈) 量各項效果的實際影響換算出來的
  const METRICS = ['速度', '加速度', '飄移', '操控性'];
  const r1 = (v) => Math.round(v * 10) / 10;
  //   彎道衝刺單圈 (K8 / GR86 / R35 平均)：動力 +10% 快 0.67 秒、氮氣 +10% 快 0.73 秒、甩尾掉速 −10% 快 0.69 秒、甩尾噴射 +10% 快 0.32 秒、
  //   集氣 +10% 快 0.1 秒 (氮氣本來就常常滿瓶)、車重 −50 kg 快 0.38 秒、風阻 −10% 快 0.13 秒 (極速 +8 km/h)、紅線 +400 快 0.12 秒；
  //   起步推力 +20% 讓 K8 的 0～100 快 0.2 秒；抓地 +10% 煞車距離短 10%；輪圈轉動慣量 −20% 幾乎沒差 (只算一點點)
  function ratingOf(e) {
    const tq = e.torque - 1;
    return [
      r1(tq * 4 + (e.nitro - 1) * 6 + e.rev / 2000 + (1 - e.cd) * 3),                                                         // 速度：動力、氮氣、紅線、風阻
      r1(tq * 4 - e.mass / 160 + (e.launch - 1) * 1.5 + (e.start - 1) * 1 + (1 - e.wheelI) * 0.5),                            // 加速度：動力、車重、起步、彈射
      r1((1 - e.dDrag) * 7 + (e.boost - 1) * 3.5 + (e.charge - 1) * 2.5),                                                      // 飄移：甩尾保速、噴射、集氣
      r1((e.mu - 1) * 15 + (e.muR - 1) * 10 + (e.brake - 1 + (e.brakeR - 1) * 0.3) * 2 + (e.stiff - 1) * 0.8 + e.lower * 4 - e.mass / 250),   // 操控性：抓地、煞車、懸吊、車重
    ];
  }
  function ratingBonus(fit, noCombo) { return ratingOf(effects(fit, noCombo)); }

  // 單一零件 (寫電腦要帶調校方向) 的效果
  function fxOf(id, map) {
    const p = part(id);
    if (!p) return null;
    return p.slot === 'ecu' ? ecuFx(+id.slice(3), map) : p.fx;
  }
  // 零件的效果說明 (介面上的小標籤 [名稱, 數值, 是代價?])：評級加減 (小數) + 其他特性
  const pct = (v) => Math.round(Math.abs(v - 1) * 100) + '%';
  function fxTags(id, map) {
    const p = part(id);
    if (!p) return [];
    if (p.slot === 'livery') return [['外觀', '純視覺，不影響性能']];
    const x = fxOf(id, map) || {}, e = blank(), t = [];
    addFx(e, x);
    ratingOf(e).forEach((v, i) => {
      if (v >= 0.05) t.push([METRICS[i], `+${v.toFixed(1)}`]);
      else if (v <= -0.05) t.push([METRICS[i], `−${(-v).toFixed(1)}`, true]);
    });
    const sign = (v, up) => (v > 1 ? '+' : '−') + pct(v);
    if (x.torque) t.push(['動力', sign(x.torque)]);
    if (x.rev) t.push(['紅線', `+${x.rev} rpm`]);
    if (x.nitro) t.push(['氮氣', sign(x.nitro)]);
    if (x.launch) t.push(['起步', sign(x.launch), x.launch < 1]);
    if (x.start) t.push(['彈射起步', sign(x.start)]);
    if (x.cd) t.push(['風阻', sign(x.cd)]);
    if (x.mu) t.push(['抓地', sign(x.mu)]);
    if (x.brake) t.push(['煞車', sign(x.brake)]);
    if (x.brakeR) t.push(['後輪煞車', sign(x.brakeR)]);
    if (x.charge) t.push(['甩尾集氣', sign(x.charge), x.charge < 1]);
    if (x.boost) t.push(['甩尾噴射', sign(x.boost)]);
    if (x.dDrag) t.push(['甩尾掉速', sign(x.dDrag)]);
    if (x.muR) t.push(['尾巴', '比較滑', true]);
    if (x.wet) t.push(['雨天抓地', x.wet <= 0.5 ? '大幅提升' : x.wet < 1 ? '提升' : '變差', x.wet > 1]);
    if (x.mass) t.push(['車重', `${x.mass > 0 ? '+' : ''}${x.mass} kg`, x.mass > 0]);
    if (x.lower) t.push(['車身', `降低 ${Math.round(x.lower * 1000) / 10} cm`]);
    if (x.loud) t.push(['聲浪', x.loud >= 1.7 ? '超大' : x.loud >= 1.4 ? '大' : '中']);
    return t;
  }
  // 搭配加成的效果說明 (評級加減)
  function comboTags(c) {
    const e = blank(), t = [];
    addFx(e, c.fx);
    ratingOf(e).forEach((v, i) => { if (Math.abs(v) >= 0.05) t.push([METRICS[i], (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1), v < 0]); });
    if (c.fx.wet) t.push(['雨天抓地', '提升']);
    return t;
  }
  // 零件 id 或 'ecu:n' 的名稱 (搭配加成的清單用)
  function tokName(tok) {
    if (tok.startsWith('ecu:')) return `寫電腦 ${ECU_MAPS[+tok.slice(4)].name}調校`;
    const p = part(tok);
    return p ? p.name : tok;
  }

  // ---- 改裝代碼：把一台車裝了什麼壓成一小段文字，跟著重播 (server/functions.js fitCode) 與多人房間 (server/room.js) 傳給別人，
  // 別人的畫面才畫得出這台車的改裝 (看重播、挑戰的幽靈車、多人比賽的其他玩家)。
  // 格式 "輪圈.色/輪胎/避震.色/卡鉗.色/排氣管/彩繪/寫電腦階數.調校方向"，沒裝的留空、尾端的空位省略，全原廠 = ''。
  // 例：'w_deep.1/t_drift/s_street.2//e_ti/lv_flame/3.2'
  const CODE_SLOTS = ['wheel', 'tire', 'susp', 'brake', 'exhaust', 'livery'];   // 順序要和 server/functions.js 的 FIT_SLOTS 一致
  function code(fit) {
    if (!fit) return '';
    const out = CODE_SLOTS.map((s) => (fit[s] ? fit[s] + (fit[s + 'C'] ? '.' + (fit[s + 'C'] | 0) : '') : ''));
    out.push(fit.ecu ? (fit.ecu | 0) + (fit.ecuC ? '.' + (fit.ecuC | 0) : '') : '');
    while (out.length && !out[out.length - 1]) out.pop();
    return out.join('/');
  }
  // 代碼 → fit (和 fitOf 的回傳同格式)；不認得的零件當作原廠，全原廠 / 空的回傳 null
  function fromCode(str) {
    if (typeof str !== 'string' || !str || str.length > 120) return null;
    const tok = str.split('/'), fit = { ecu: 0, ecuC: 0 };
    let any = false;
    CODE_SLOTS.forEach((s, i) => {
      const [id, c] = (tok[i] || '').split('.'), p = id && part(id);
      fit[s] = p && p.slot === s ? id : null;
      fit[s + 'C'] = fit[s] ? Math.max(0, Math.min(9, c | 0)) : 0;
      if (fit[s]) any = true;
    });
    const [lv, mp] = (tok[CODE_SLOTS.length] || '').split('.');
    fit.ecu = Math.max(0, Math.min(3, lv | 0));
    fit.ecuC = fit.ecu ? Math.max(0, Math.min(ECU_MAPS.length - 1, mp | 0)) : 0;
    return any || fit.ecu ? fit : null;
  }

  RM.Tuning = { code, fromCode, SLOTS, PARTS, FIN, ECU_MAPS, COMBOS, LIVERY_PRICE, METRICS, part, partsOf, empty, fitOf, effects, applyEffects, applySpec, ecuFx, combosOf, has, fxTags, comboTags, tokName, ratingBonus, ratingOf, liveries };
})();
