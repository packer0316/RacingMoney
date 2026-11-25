'use strict';
// 所有 GLSL (WebGL2 / GLSL ES 3.00)
(function () {
  const RM = window.RM;

  const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
layout(std140) uniform Frame {
  mat4 uViewProj; mat4 uView; mat4 uShadowMat;
  vec4 uCamPos; vec4 uSunDir; vec4 uSunColor; vec4 uSkyColor; vec4 uGroundColor;
  vec4 uFogColor; vec4 uFogParams; vec4 uHeadL; vec4 uHeadR; vec4 uHeadDir; vec4 uMisc;
  vec4 uSkyZenith; vec4 uSkyHorizon;
  vec4 uTailL; vec4 uTailR; vec4 uCarP; vec4 uCarF;
  mat4 uViewProjRel;
};
// 世界座標 → 裁切座標 (先減相機位置再投影，避免大座標相消造成的深度雜訊)
vec4 projWorld(vec3 wp){ return uViewProjRel*vec4(wp - uCamPos.xyz, 1.0); }
`;

  const LIGHT = `
uniform sampler2DShadow uShadowMap;
uniform float uShadowBias;
const float PI = 3.14159265;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
vec3 finalColor(vec3 c){ c *= uSunColor.w; c = aces(c); return pow(c, vec3(1.0/2.2)); }
float shadowFactor(vec3 wp, vec3 n){
  if (uMisc.x < 0.5) return 1.0;
  vec4 sp = uShadowMat * vec4(wp + n*(0.06 + uShadowBias), 1.0);
  vec3 p = sp.xyz/sp.w*0.5+0.5;
  if (p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0) return 1.0;
  // 4 次取樣 (各錯開 0.75 texel)；每次取樣是硬體 2x2 雙線性深度比較，合起來約 3.5x3.5 texel 的柔邊，
  // 比原本 9 次取樣省一半以上的貼圖讀取 (陰影範圍涵蓋畫面近處大部分像素)
  float t = uMisc.y*0.75, z = p.z-0.0004;
  float s = texture(uShadowMap, vec3(p.xy+vec2(-t,-t), z)) + texture(uShadowMap, vec3(p.xy+vec2(t,-t), z))
          + texture(uShadowMap, vec3(p.xy+vec2(-t,t), z)) + texture(uShadowMap, vec3(p.xy+vec2(t,t), z));
  vec2 e = abs(p.xy-0.5)*2.0;
  return mix(s*0.25, 1.0, smoothstep(0.8,1.0,max(e.x,e.y)));
}
// 植生用：單次取樣 (硬體 2x2)。樹葉本身零碎，看不出柔邊差異
float shadowFactor1(vec3 wp, vec3 n){
  if (uMisc.x < 0.5) return 1.0;
  vec4 sp = uShadowMat * vec4(wp + n*0.06, 1.0);
  vec3 p = sp.xyz/sp.w*0.5+0.5;
  if (p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0) return 1.0;
  float s = texture(uShadowMap, vec3(p.xy, p.z-0.0004));
  vec2 e = abs(p.xy-0.5)*2.0;
  return mix(s, 1.0, smoothstep(0.8,1.0,max(e.x,e.y)));
}
vec3 skyColorDir(vec3 d){
  float y = d.y;
  vec3 c = mix(uSkyHorizon.rgb, uSkyZenith.rgb, pow(clamp(y,0.0,1.0),0.5));
  c = mix(c, uGroundColor.rgb*0.5, smoothstep(0.0,-0.3,y));
  float sd = max(dot(d,uSunDir.xyz),0.0);
  c += uSunColor.rgb*pow(sd,24.0)*0.35;
  return mix(c, uFogColor.rgb, uFogParams.w);
}
// 車漆 / 玻璃反射用的環境。戶外：天空 (淡雲) + 地平線上不規則的樹線 + 路面 (山路)；
// 車庫 (uMisc.z = 1)：暗棚 + 頂上柔光箱 + 兩側長燈 + 牆面燈帶 —— 長條光源在車身上拉出的高光最能顯出曲面與稜線
float gCarEnv = 0.0;
vec3 studioEnv(vec3 d){
  vec3 c = vec3(0.016,0.019,0.022) + vec3(0.03,0.034,0.04)*smoothstep(-0.1, 0.9, d.y);
  if (d.y > 0.03){
    vec2 p = d.xz/d.y;                                  // 投影到頭頂 1 m 的平面
    float box = (1.0 - smoothstep(0.3, 0.7, abs(p.x)))*(1.0 - smoothstep(1.3, 2.2, abs(p.y)));
    float side = (1.0 - smoothstep(0.08, 0.2, abs(abs(p.x) - 1.3)))*(1.0 - smoothstep(2.0, 3.0, abs(p.y)));
    c += vec3(1.0,0.985,0.96)*(0.95*box + 0.7*side);
  }
  float band = smoothstep(0.035, 0.07, d.y)*(1.0 - smoothstep(0.15, 0.21, d.y));
  c += vec3(0.82,0.9,1.0)*0.5*band*(0.65 + 0.35*sin(atan(d.x, d.z)*4.0 + 0.8));
  vec3 fl = vec3(0.022,0.026,0.028) + vec3(0.05,0.055,0.06)*smoothstep(-0.02, -0.5, d.y);
  return mix(c, fl, smoothstep(0.012, -0.012, d.y));
}
// 同一個環境的模糊版 (金屬粉底漆 / 粗糙表面的反射)：朝天亮、朝地暗
vec3 carEnvSoft(vec3 d){
  if (uMisc.z > 0.5) return vec3(0.03,0.034,0.038) + vec3(1.0,0.985,0.96)*0.5*smoothstep(0.2, 1.0, d.y) + vec3(0.82,0.9,1.0)*0.07*smoothstep(0.35, 0.0, abs(d.y - 0.1));
  vec3 sky = mix(uSkyHorizon.rgb, uSkyZenith.rgb, 0.3 + 0.4*clamp(d.y, 0.0, 1.0));
  sky += uSunColor.rgb*pow(max(dot(d, uSunDir.xyz), 0.0), 6.0)*0.1;
  vec3 c = mix(uGroundColor.rgb*0.55, sky, smoothstep(-0.3, 0.35, d.y));
  return mix(c, uFogColor.rgb, uFogParams.w);
}
vec3 carEnv(vec3 d){
  if (uMisc.z > 0.5) return studioEnv(d);
  vec3 c = skyColorDir(vec3(d.x, max(d.y, 0.0), d.z));
  float az = atan(d.x, d.z);
  if (d.y > 0.0){
    // 淡雲：方向投影到雲層平面，幾個正弦疊出柔和的雲塊 (引擎蓋、車頂、玻璃上的倒影才不會是一片死藍)
    vec2 p = d.xz/(d.y + 0.22)*1.6;
    float cl = sin(p.x*1.3 + 1.7*sin(p.y*0.8 + 0.5))*sin(p.y*1.1 + 1.3*sin(p.x*0.7 + 2.0)) + 0.5*sin(p.x*2.9 + p.y*2.3);
    c += (uSkyHorizon.rgb*0.5 + uSunColor.rgb*0.03)*smoothstep(0.25, 1.1, cl)*smoothstep(0.02, 0.25, d.y)*(1.0 - uFogParams.w);
  }
  float h = 0.11 + 0.07*sin(az*2.0+0.7) + 0.045*sin(az*5.0+2.1) + 0.02*sin(az*13.0+0.3);
  float tree = 1.0 - smoothstep(h-0.015, h+0.035, d.y);
  vec3 lit = uSunColor.rgb*max(uSunDir.y,0.0)*0.55 + mix(uGroundColor.rgb, uSkyColor.rgb, 0.7);
  c = mix(c, mix(vec3(0.05,0.07,0.045)*lit, uFogColor.rgb, uFogParams.w), tree);
  vec3 gnd = vec3(0.13,0.13,0.135)*(uSunColor.rgb*max(uSunDir.y,0.0) + mix(uGroundColor.rgb, uSkyColor.rgb, 0.5)*1.4);
  return mix(c, mix(gnd, uFogColor.rgb, uFogParams.w*0.6), smoothstep(0.015,-0.05,d.y));
}
// 玩家車尾燈 / 煞車燈對周圍 (路面、保桿) 的紅色照明
float gTailK = 1.0;
vec3 tailLight(vec3 wp, vec3 n){
  if (uTailL.w*gTailK <= 0.0) return vec3(0.0);
  float s = 0.0;
  for (int i=0;i<2;i++){
    vec3 L = (i==0 ? uTailL.xyz : uTailR.xyz) - wp; float d2 = dot(L,L);
    s += max(dot(n, L*inversesqrt(d2)), 0.0)/(d2 + 0.12);
  }
  return vec3(1.0,0.06,0.025)*s*uTailL.w*gTailK;
}
// 車底接觸陰影 (環境遮蔽)：車身投影範圍內的地面變暗
float carShade(vec3 wp){
  if (uCarP.w <= 0.0) return 1.0;
  vec2 rel = wp.xz - uCarP.xz;
  vec2 q = abs(vec2(dot(rel, vec2(-uCarF.y, uCarF.x)), dot(rel, uCarF.xy))) - vec2(uCarF.z, uCarF.w);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float occ = 1.0 - smoothstep(-0.35, 0.3, d);
  occ *= 1.0 - smoothstep(0.3, 1.2, abs(wp.y - uCarP.y));
  return 1.0 - uCarP.w*occ;
}
vec3 headLight(vec3 wp, vec3 n){
  if (uHeadL.w <= 0.0) return vec3(0.0);
  vec3 sum = vec3(0.0);
  for (int i=0;i<2;i++){
    vec3 lp = i==0 ? uHeadL.xyz : uHeadR.xyz;
    vec3 L = lp - wp; float d2 = dot(L,L); float d = sqrt(d2); L /= d;
    vec3 ray = -L;
    float spot = smoothstep(uHeadDir.w, uHeadDir.w+0.10, dot(ray, uHeadDir.xyz));
    float cut = 1.0 - smoothstep(-0.015, 0.03, ray.y + 0.012);
    float hot = 1.0 + 1.5*smoothstep(0.985, 0.998, dot(ray, uHeadDir.xyz));
    sum += vec3(1.0,0.9,0.75)*spot*cut*hot*max(dot(n,L),0.0)*uHeadL.w/(d2+1.5);
  }
  return sum;
}
// 金屬度/粗糙度 PBR + 天空環境光 + 車燈
vec3 lightSurface(vec3 alb, vec3 n, vec3 wp, float rough, float metal, float ao, float sh, float coat){
  vec3 V = normalize(uCamPos.xyz - wp);
  vec3 L = uSunDir.xyz;
  float ndl = max(dot(n,L),0.0);
  vec3 H = normalize(L+V);
  float ndh = max(dot(n,H),0.0), ndv = max(dot(n,V),1e-3), vdh = max(dot(V,H),0.0);
  float a = max(rough*rough,0.003), a2 = a*a;
  float dd = ndh*ndh*(a2-1.0)+1.0;
  float D = a2/(PI*dd*dd);
  float k = a*0.5;
  float G = (ndl/(ndl*(1.0-k)+k))*(ndv/(ndv*(1.0-k)+k));
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 F = F0 + (1.0-F0)*pow(1.0-vdh,5.0);
  vec3 spec = D*G*F/max(4.0*ndl*ndv,1e-3);
  vec3 kd = (1.0-F)*(1.0-metal);
  vec3 col = (kd*alb/PI + spec)*ndl*uSunColor.rgb*sh*PI;
  vec3 amb = mix(uGroundColor.rgb, uSkyColor.rgb, n.y*0.5+0.5);
  col += alb*(1.0-metal)*amb*ao;
  vec3 R = reflect(-V,n);
  float fres = pow(1.0-ndv,5.0);
  // 金屬表面 (輪圈、鍍鉻、排氣管、護欄…) 也反射完整的環境 (樹線 / 路面；車庫裡是柔光箱)，不然只會映出一片天空色
  vec3 envc = (gCarEnv > 0.5 || metal > 0.5 || uMisc.z > 0.5) ? carEnv(R) : skyColorDir(R);
  vec3 env = envc*mix(F0, vec3(1.0), fres)*(1.0-rough)*(1.0-rough);
  col += env*ao*(0.35+0.65*sh);
  if (coat > 0.0){
    // 透明漆：較寬的高光避免面片閃爍 + 天空反射
    float cr = 0.11 + coat*0.0; float ca = cr*cr*cr*cr;
    float ddc = ndh*ndh*(ca-1.0)+1.0; float Dc = min(ca/(PI*ddc*ddc), 40.0);
    float Fc = 0.04 + 0.96*pow(1.0-vdh,5.0);
    col += vec3(Dc*Fc*0.25)*ndl*uSunColor.rgb*sh;
    col += envc*(0.04+0.96*fres)*ao*0.9;
  }
  vec3 hl = headLight(wp, n) + tailLight(wp, n);
  col += hl*(kd*alb + spec*0.3 + F0*0.5);
  return col;
}
vec3 applyFog(vec3 col, vec3 wp){
  vec3 d = wp - uCamPos.xyz; float dist = length(d);
  vec3 rd = d/max(dist,1e-3);
  float k = uFogParams.x, dens = uFogColor.w;
  float hc = clamp(-k*(uCamPos.y-uFogParams.y), -30.0, 30.0);
  float kdy = k*d.y;
  float fi = abs(kdy) > 1e-3 ? dens*exp(hc)*(1.0-exp(-kdy))/kdy*dist : dens*exp(hc)*dist;
  float f = 1.0 - exp(-max(fi,0.0));
  float sa = pow(max(dot(rd,uSunDir.xyz),0.0),8.0);
  vec3 fc = uFogColor.rgb + uSunColor.rgb*sa*uFogParams.z;
  return mix(col, fc, f);
}
`;

  // ------------------------------------------------------------ 車漆 (車殼與車色零件共用)
  // 兩層：金屬粉底漆 (鋁粉把高光打散成一片、各自朝向不同 → 顆粒閃點；掠射角變深) + 透明漆 (銳利的環境倒影與太陽高光)
  const PAINT = `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
// 亮片雜訊：q = 表面座標 (公尺)、fw = 一個像素涵蓋的公尺數。格子大小跟著像素走 (兩級之間漸變)，
// 所以遠近都看得到細緻的金屬顆粒，又不會因為格子小於像素而閃爍
vec4 paintFlake(vec2 q, float fw){
  float lod = max(log2(max(fw, 1e-6)/0.0016), 0.0), l0 = floor(lod), f = lod - l0;
  float s0 = 0.0024*exp2(l0);
  vec2 c0 = floor(q/s0), c1 = floor(q/(s0*2.0));
  vec4 a = vec4(hash21(c0), hash21(c0 + 17.3), hash21(c0 + 41.7), hash21(c0 + 71.1));
  vec4 b = vec4(hash21(c1 + 5.1), hash21(c1 + 23.9), hash21(c1 + 57.3), hash21(c1 + 91.7));
  return mix(a, b, f);
}
// base 車色、mk 金屬感 (0 素色 ~ 0.6 銀)、flk 亮片 (沒有就給 vec4(0.5))、ra 額外粗糙度 (幾何反鋸齒)、ck 透明漆完整度
vec3 carPaint(vec3 base, vec3 n, vec3 wp, float mk, vec4 flk, float ao, float sh, float ra, float ck){
  vec3 V = normalize(uCamPos.xyz - wp), L = uSunDir.xyz;
  float ndv = max(dot(n,V), 1e-3), ndl = max(dot(n,L), 0.0);
  vec3 H = normalize(L + V);
  float vdh = max(dot(V,H), 0.0);
  float mm = smoothstep(0.0, 0.5, mk);
  // ---- 底漆
  float ndh = max(dot(n,H), 0.0);
  vec3 alb = base*mix(1.0, 1.0 - 0.55*mk, pow(1.0 - ndv, 1.5));      // flop：掠射角變深
  alb *= 1.0 - 0.2*smoothstep(0.5, 0.9, max(base.r, max(base.g, base.b)));   // 很淺的車色壓一點亮度，日照下才不會整片過曝看不出曲面
  float rb = clamp(mix(0.62, 0.36, mm) + ra, 0.05, 1.0);
  float a = rb*rb, a2 = a*a, dd = ndh*ndh*(a2 - 1.0) + 1.0;
  float D = a2/(PI*dd*dd);
  vec3 F0 = mix(vec3(0.04), base, mk*0.9);
  vec3 F = F0 + (1.0 - F0)*pow(1.0 - vdh, 5.0);
  float k = a*0.5, G = (ndl/(ndl*(1.0-k)+k))*(ndv/(ndv*(1.0-k)+k));
  // 鋁粉顆粒：高光裡細緻的明暗顆粒 + 零星閃點 (都只出現在高光附近，暗處不會有雜點)
  float grain = 1.0 + (flk.x - 0.5)*0.5*mm;
  vec3 spec = D*G*F/max(4.0*ndl*ndv, 1e-3)*grain;
  spec += F0*smoothstep(0.94, 1.0, flk.w)*pow(ndh, 48.0)*mm*0.9;
  vec3 kd = (1.0 - F)*(1.0 - mk*0.8);
  vec3 col = (kd*alb/PI + spec)*ndl*uSunColor.rgb*sh*PI;
  vec3 amb = mix(uGroundColor.rgb, uSkyColor.rgb, n.y*0.5 + 0.5);
  col += alb*(1.0 - mk*0.8)*amb*ao;
  vec3 R = reflect(-V, n);
  float fres = pow(1.0 - ndv, 5.0);
  col += carEnvSoft(R)*(F0 + (1.0 - F0)*fres*0.35)*mm*ao*(0.45 + 0.55*sh)*mix(1.0, grain, 0.6);
  vec3 hl = headLight(wp, n) + tailLight(wp, n);
  col += hl*(kd*alb + F0*0.5 + 0.04);
  // ---- 透明漆
  float Fc = min(0.045 + 0.955*fres, 0.72);    // 掠射角不讓它變成全鏡面：車頂 / 行李廂在低視角下才不會整片被天空或柔光箱洗白
  col *= 1.0 - Fc*0.8*ck;
  float rc = 0.09 + ra*0.7, ca = rc*rc; ca *= ca;
  float ddc = ndh*ndh*(ca - 1.0) + 1.0;
  float Dc = min(ca/(PI*ddc*ddc), 48.0);
  float Fh = 0.045 + 0.955*pow(1.0 - vdh, 5.0);
  col += (Dc*0.25 + pow(ndh, 70.0)*0.3)*Fh*ndl*uSunColor.rgb*sh*ck;     // 銳利亮點 + 外圍柔和光暈
  col += carEnv(R)*Fc*ck*mix(1.0, ao, 0.6)*(0.4 + 0.6*sh);
  return col;
}
`;

  // ------------------------------------------------------------ terrain
  const terrainVS = HEAD + `
in vec3 aPos; in vec3 aNormal; in vec4 aExtra;
out vec3 vPos; out vec3 vN; out vec4 vExt;
void main(){ vPos=aPos; vN=aNormal; vExt=aExtra; gl_Position = projWorld(aPos); }`;

  const terrainFS = HEAD + LIGHT + `
in vec3 vPos; in vec3 vN; in vec4 vExt;
uniform sampler2D uAlbedo; uniform sampler2D uTex1; uniform sampler2D uTex2; uniform sampler2D uTex3; uniform sampler2D uNoise;
out vec4 oColor;
void main(){
  vec3 n = normalize(vN);
  vec2 p = vPos.xz;
  float dist = distance(vPos, uCamPos.xyz);
  vec4 nz = texture(uNoise, p*0.0031);
  vec4 nz2 = texture(uNoise, p*0.027);
  vec4 nz3 = texture(uNoise, p*0.00061);
  float slope = 1.0 - n.y;
  // 森林樹冠：以雜訊擾動法線，模擬遠處成片闊葉林起伏
  vec4 cn = texture(uNoise, p*0.045);
  vec3 bump = vec3(cn.r-0.5, 0.0, cn.g-0.5)*0.9*smoothstep(30.0, 140.0, dist);
  float roadProx = vExt.x, cut = vExt.y;
  float verge = smoothstep(0.25, 0.8, roadProx);
  vec3 nb = normalize(n + bump*(1.0-verge));
  vec3 canopy = texture(uTex1, p*0.016).rgb;
  vec3 canopy2 = texture(uTex1, p*0.0037+0.37).rgb;
  vec3 forest = mix(canopy, canopy2, 0.45)*(0.7+0.6*nz.r)*(0.85+0.3*nz3.g);
  forest = mix(forest, forest*vec3(1.15,1.05,0.8), smoothstep(0.55,0.8,nz3.b)); // 季節/樹種色差
  vec3 grass = texture(uAlbedo, p*0.19).rgb*(0.8+0.4*nz2.g);
  vec3 rock = texture(uTex2, p*0.08).rgb*(0.85+0.3*nz2.b);
  vec3 dirt = texture(uTex3, p*0.13).rgb;
  vec3 col = forest; float rough = 0.95;
  col = mix(col, grass, verge);
  float rk = smoothstep(0.62, 0.85, slope + (nz.b-0.5)*0.35);
  col = mix(col, rock, rk);
  // 路旁邊坡：挖方 → 格框護坡 / 裸露土石
  float cutAmt = smoothstep(0.6, 3.0, cut)*smoothstep(0.12, 0.35, slope)*smoothstep(0.05,0.4,roadProx);
  if (cutAmt > 0.01){
    vec3 th = normalize(cross(vec3(0.0,1.0,0.0), n) + vec3(1e-4,0.0,0.0));
    vec2 g = vec2(dot(vPos, th)/2.6, vPos.y/2.2);
    vec2 fg = abs(fract(g)-0.5);
    float aa = fwidth(g.x)+fwidth(g.y);
    float line = 1.0 - smoothstep(0.42-aa, 0.44+aa, max(fg.x,fg.y));
    line = 1.0-line;
    vec3 inner = mix(grass*0.85, dirt, 0.35+0.4*nz2.r);
    vec3 frame = vec3(0.42,0.41,0.38)*(0.8+0.3*nz2.g);
    float useGrid = step(0.45, nz3.r);
    vec3 cc = mix(mix(dirt, rock, 0.4), mix(inner, frame, line), useGrid);
    col = mix(col, cc, cutAmt);
  }
  float fill = smoothstep(0.5, 3.0, -cut)*verge;
  col = mix(col, grass*vec3(0.95,1.0,0.85), fill*0.6);
  // 蘭陽平原：稻田
  float low = (1.0 - smoothstep(10.0, 28.0, vPos.y))*(1.0 - smoothstep(0.02, 0.07, slope));
  nb = normalize(mix(nb, vec3(0.0,1.0,0.0), (1.0 - smoothstep(15.0, 60.0, vPos.y))*(1.0 - smoothstep(0.03, 0.12, slope))*0.85));
  if (low > 0.01){
    // 田區：依大尺度雜訊分區、細長田坵 (約 25 x 60 m)
    vec2 q = vec2(p.x*0.8 + p.y*0.6, -p.x*0.6 + p.y*0.8);
    vec2 cell = floor(q/vec2(26.0, 62.0));
    vec2 cf = fract(q/vec2(26.0, 62.0));
    vec4 r = texture(uNoise, cell*0.0137+0.5);
    float region = texture(uNoise, p*0.00023).g;
    vec3 young = vec3(0.16,0.3,0.07), ripe = vec3(0.34,0.36,0.1);
    vec3 rice = mix(young, ripe, smoothstep(0.35, 0.75, region + (r.r-0.5)*0.25));
    rice *= 0.9 + 0.2*r.b;
    float flooded = step(0.86, r.g)*step(region, 0.5);
    rice = mix(rice, vec3(0.2,0.24,0.24), flooded);
    float ed = min(min(cf.x,1.0-cf.x)*26.0, min(cf.y,1.0-cf.y)*62.0);
    float ridge = (1.0 - smoothstep(0.3, 0.9, ed))*(1.0 - smoothstep(300.0, 900.0, dist));
    rice = mix(rice, vec3(0.28,0.27,0.18), ridge*0.7);
    col = mix(col, rice*(0.9+0.2*nz2.r), low);
    rough = mix(rough, mix(0.9, 0.12, flooded), low);
  }
  // 海床 / 沙灘
  float beach = 1.0 - smoothstep(0.6, 2.5, vPos.y);
  col = mix(col, vec3(0.36,0.33,0.27), beach);
  float wet = uSkyColor.w;
  col *= mix(1.0, 0.7, wet);
  float sh = shadowFactor(vPos, n);
  vec3 c = lightSurface(col, nb, vPos, mix(rough, 0.5, wet*0.6), 0.0, 1.0, sh, 0.0);
  c *= carShade(vPos);
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), 1.0);
}`;

  // ------------------------------------------------------------ road
  const roadVS = HEAD + `
in vec3 aPos; in vec3 aNormal; in vec2 aUV; in vec4 aExtra;
out vec3 vPos; out vec3 vN; out vec2 vUV; out vec4 vExt;
void main(){ vPos=aPos; vN=aNormal; vUV=aUV; vExt=aExtra; gl_Position = projWorld(aPos); }`;

  const roadFS = HEAD + LIGHT + `
in vec3 vPos; in vec3 vN; in vec2 vUV; in vec4 vExt;
uniform sampler2D uAlbedo; uniform sampler2D uTex1; uniform sampler2D uTex2; uniform sampler2D uTex3; uniform sampler2D uNoise;
out vec4 oColor;
float band(float x, float a, float b, float aa){ return smoothstep(a-aa, a+aa, x)*(1.0-smoothstep(b-aa, b+aa, x)); }
void main(){
  vec3 n = normalize(vN);
  float d = vUV.x, s = vUV.y;
  float W = vExt.x, zone = vExt.y, strip = vExt.z, side = vExt.w;
  vec3 alb; float rough; float metal = 0.0;
  vec4 nz = texture(uNoise, vPos.xz*0.011);
  vec4 nz2 = texture(uNoise, vec2(d*0.13, s*0.021));
  float wet = uSkyColor.w;
  float emis = 0.0; vec3 emisCol = vec3(0.0);
  if (strip < 0.5){
    // 柏油
    vec3 a = texture(uAlbedo, vec2(d, s)*0.27).rgb;
    vec3 a2 = texture(uAlbedo, vec2(d, s)*0.061+0.5).rgb;
    alb = mix(a, a2, 0.35);
    alb *= 0.78 + 0.34*nz.r + 0.18*(nz2.g-0.5);
    // 修補過的柏油塊
    vec2 pc = vec2(d*0.35, s*0.06);
    vec4 pn = texture(uNoise, floor(pc)*0.131);
    vec2 pf = fract(pc);
    float patchA = step(0.86, pn.r)*step(0.1, pf.x)*step(pf.x, 0.9)*step(0.15, pf.y)*step(pf.y, 0.8);
    alb = mix(alb, alb*0.62, patchA);
    // 輪跡：車道中央兩條較暗、較光滑
    float ad = abs(d);
    float tr = exp(-pow((ad-1.0)/0.32,2.0)) + exp(-pow((ad-2.6)/0.32,2.0)) + exp(-pow((ad-4.6)/0.32,2.0)) + exp(-pow((ad-6.2)/0.32,2.0));
    alb *= 1.0 - 0.13*tr;
    rough = 0.88 - 0.16*tr;
    // 裂縫填封 (深色細線)
    vec4 cr = texture(uTex2, vec2(d, s)*0.11);
    alb *= 1.0 - cr.r*0.55;
    // 標線
    float aa = fwidth(d)*1.0 + 0.004;
    float wear = smoothstep(0.15, 0.55, texture(uNoise, vec2(d*1.7, s*0.37)).g + 0.25);
    float yel = band(d, 0.06, 0.18, aa) + band(d, -0.18, -0.06, aa);
    bool closedCourse = zone < -0.5;
    if (closedCourse) { yel = 0.0; alb *= 0.78; }
    float edgeL = closedCourse ? W - 0.32 : min(7.2, W - 0.62);
    float edge = band(ad, edgeL, edgeL+0.15, aa);
    // 同向車道分隔線 (白虛線 4 m 線 / 6 m 間隔)
    float dash = step(mod(s, 10.0), 4.0) * step(6.0, edgeL);
    float lane = closedCourse ? (W - 0.32) * 0.5 : 3.6;
    float divider = band(ad, lane-0.07, lane+0.07, aa);
    if (closedCourse) divider = max(divider, band(d, -0.07, 0.07, aa));
    edge = max(edge, divider * dash * (closedCourse ? 0.72 : 1.0));
    vec3 paintY = vec3(0.78, 0.5, 0.05);
    vec3 paintW = vec3(0.82, 0.82, 0.8);
    vec3 paintR = vec3(0.65, 0.06, 0.04);
    vec3 edgeC = zone > 0.5 ? paintR : paintW;
    alb = mix(alb, paintY, yel*wear);
    alb = mix(alb, edgeC, edge*wear);
    rough = mix(rough, 0.55, max(yel, edge)*wear);
    // Reuse the existing asphalt sample for millimetre aggregate relief (no new fetch).
    vec3 dpX=dFdx(vPos), dpY=dFdy(vPos), bx=cross(dpY,n), by=cross(n,dpX);
    float det=dot(dpX,bx);
    float height=dot(a,vec3(0.333))*0.012;
    float relief=(1.0-smoothstep(18.0,65.0,distance(vPos,uCamPos.xyz)))*(1.0-max(yel,edge)*wear)*(1.0-wet*0.85);
    n=normalize(n-sign(det)*(bx*dFdx(height)+by*dFdy(height))/max(abs(det),1e-6)*relief);
    // 反光導標 (貓眼) 每 6 m
    float rpm = band(mod(s, 6.0), 0.0, 0.12, 0.01)*band(d, -0.05, 0.05, 0.005);
    alb = mix(alb, vec3(0.9,0.75,0.2), rpm);
    emis = rpm; emisCol = vec3(1.0,0.7,0.15);
    // 濕地/水窪
    float puddle = smoothstep(0.62, 0.72, nz.g + tr*0.08)*wet;
    alb *= mix(1.0, 0.5, wet);
    rough = mix(rough, 0.25, wet*0.7);
    rough = mix(rough, 0.03, puddle);
  } else {
    // 路肩/排水溝/邊坡裙
    float e = abs(d) - W;
    vec3 conc = texture(uTex1, vec2(d, s)*0.4).rgb;
    vec3 dirt = texture(uTex3, vec2(d, s)*0.25).rgb;
    if (side < 0.5){              // 水溝側
      alb = e < 0.35 ? conc : (e < 0.8 ? conc*0.6 : dirt);
      rough = 0.9;
    } else if (side < 1.5){      // 護欄側：碎石雜草
      alb = e < 0.9 ? mix(conc*0.7, vec3(0.2,0.25,0.12), nz2.r*0.7) : dirt;
      rough = 0.95;
    } else {                     // 橋
      alb = conc*0.85; rough = 0.85;
    }
    alb *= mix(1.0, 0.65, wet);
  }
  float sh = shadowFactor(vPos, n);
  vec3 c = lightSurface(alb, n, vPos, rough, metal, 1.0, sh, 0.0);
  // 夜間反光標線 / 貓眼回歸反射
  c += emisCol*emis*length(headLight(vPos, vec3(0.0,1.0,0.0)))*3.0;
  c *= carShade(vPos);
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), 1.0);
}`;

  // ------------------------------------------------------------ props (靜態物件/車輛)
  const propVS = HEAD + `
in vec3 aPos; in vec3 aNormal; in vec2 aUV; in vec4 aColor; in vec4 aExtra;
uniform mat4 uModel;
out vec3 vPos; out vec3 vN; out vec2 vUV; out vec4 vCol; out vec4 vExt; out vec3 vLocal;
void main(){
  vec4 wp = uModel*vec4(aPos,1.0);
  vPos = wp.xyz; vN = mat3(uModel)*aNormal; vUV=aUV; vCol=aColor; vExt=aExtra; vLocal = aPos;
  gl_Position = projWorld(wp.xyz);
}`;

  const propFS = HEAD + LIGHT + PAINT + `
in vec3 vPos; in vec3 vN; in vec2 vUV; in vec4 vCol; in vec4 vExt; in vec3 vLocal;
uniform sampler2D uAtlas;
uniform highp sampler2DArray uSurface;
uniform sampler2D uNoise;
uniform float uSurfaceRange;
uniform vec3 uPaint; uniform vec4 uLights; uniform vec4 uLights2; uniform float uGlass; uniform float uDirt; uniform float uPaintMetal;
out vec4 oColor;
void main(){
  vec3 alb = vCol.rgb; float rough = vCol.a; float metal = vExt.x; vec3 emis = vec3(0.0);
  int mode = int(vExt.z+0.5);
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float coat = 0.0; float alpha = 1.0;
  float night = uSunDir.w;
  float surfaceDist=distance(vPos,uCamPos.xyz);
  if (mode==32) { vec4 macro=texture(uNoise,vPos.xz*0.017); alb *= 0.60 + macro.g*0.55 + macro.b*0.35; }
  if (mode>=20 && mode<=32 && surfaceDist<uSurfaceRange){
    // One packed sample gives shade, bump and roughness. No extra material draw calls.
    vec3 an = abs(n), tu, tv;
    if (mode==32 || an.y>=max(an.x,an.z)) { tu=vec3(1,0,0); tv=vec3(0,0,1); }
    else if (an.x>an.z) { tu=vec3(0,0,1); tv=vec3(0,1,0); }
    else { tu=vec3(1,0,0); tv=vec3(0,1,0); }
    vec2 p=vec2(dot(vPos,tu),dot(vPos,tv));
    float layer=float(mode-20), scale=0.65;
    if (mode==20) scale=0.8;
    else if (mode==23) scale=0.48;
    else if (mode==24) scale=0.6;
    else if (mode==25) scale=0.16;
    else if (mode==26) scale=0.55;
    else if (mode==27) { p=vUV; scale=1.0; }
    else if (mode==29) scale=2.0;
    else if (mode==30) scale=1.5;
    else if (mode==32) {
      // Ground masks are baked in existing UVs; vertex colors keep transitions soft.
      layer = vUV.x>0.5 ? 4.0 : vUV.y>0.45 ? 5.0 : vUV.y< -0.25 ? 1.0 : 3.0;
      scale = layer==5.0 ? 0.14 : layer==4.0 ? 0.55 : 0.42;
    }
    vec2 uv=p*scale, dx=dFdx(uv), dy=dFdy(uv);
    vec4 detail=textureGrad(uSurface,vec3(uv,layer),dx,dy);
    float nearDetail=1.0-smoothstep(uSurfaceRange*0.39,uSurfaceRange,surfaceDist);
    // Mips filter subpixel grain; additionally fade bump before it can shimmer.
    float bumpFade=nearDetail*(1.0-smoothstep(0.025,0.18,max(length(dx),length(dy))));
    alb *= mix(1.0,detail.r/0.78,0.88*nearDetail);
    rough = mix(rough,detail.a,0.75*nearDetail);
    if (mode==27) {
      // Leaf normals follow the leaflet UV direction, including mirrored halves.
      vec3 px=dFdx(vPos), py=dFdy(vPos), cx=cross(py,n), cy=cross(n,px);
      tu=cx*dx.x+cy*dy.x; tv=cx*dx.y+cy*dy.y;
      float inv=inversesqrt(max(max(dot(tu,tu),dot(tv,tv)),1e-8)); tu*=inv; tv*=inv;
    } else { tu=normalize(tu-n*dot(n,tu)); tv=normalize(tv-n*dot(n,tv)); }
    n=normalize(n+(tu*(detail.g-0.50196)+tv*(detail.b-0.50196))*3.0*bumpFade);
    if (mode==20) {
      // Coated embossed sheet, keeps arrow contrast under grazing sunset light.
      rough=max(rough,0.38);
    } else if (mode==21) {
      // Six-metre concrete panels, inset joints, runoff and a scuffed lower edge.
      float jointDist=abs(fract(vUV.x/6.0+0.5)-0.5)*6.0;
      float aa=max(fwidth(vUV.x),0.004);
      float joint=1.0-smoothstep(0.012,0.027+aa,jointDist);
      float foot=1.0-smoothstep(0.02,0.25,vUV.y);
      float grime=texture(uNoise,vec2(vUV.x*0.11,vUV.y*0.65)).r;
      alb *= 1.0-joint*0.42*nearDetail-foot*(0.12+grime*0.26);
      rough=max(rough,0.82);
    }
  } else if (mode==1 || mode==2 || mode==10 || mode==12){
    vec4 t = texture(uAtlas, vUV);
    if ((mode==2 || mode==12) && t.a < 0.5) discard;
    if (mode != 12) alb *= t.rgb;
    if (mode==10) emis += t.rgb*(1.0-t.a)*night*vec3(1.6,1.3,0.9)*2.5;
  } else if (mode==3){
    alb = uPaint; coat = 1.0; gCarEnv = 1.0;
    alb *= 1.0 - uDirt*smoothstep(0.1, -0.5, vLocal.y)*0.4;
    // 幾何鏡面反鋸齒：法線變化大處提高粗糙度
    vec3 dn = fwidth(n);
    rough = clamp(max(rough, length(dn)*1.6), 0.0, 0.7);
  } else if (mode==5){
    alb = vec3(0.6); rough = 0.05; metal = 1.0;
    emis = vec3(1.0,0.93,0.8)*uLights.x*1.2;
  } else if (mode==14 || mode==15){
    // 尾燈：貼圖 alpha 區分 煞車/尾燈(1.0)、方向燈(0.55)、倒車燈(0.3)、燈殼(<0.2)
    vec4 t = texture(uAtlas, vUV);
    alb = t.rgb; rough = 0.12;
    float a = t.a;
    float red = smoothstep(0.75, 0.85, a);
    float amb = smoothstep(0.45, 0.5, a)*(1.0 - smoothstep(0.62, 0.7, a));
    float rev = smoothstep(0.22, 0.26, a)*(1.0 - smoothstep(0.36, 0.42, a));
    float blink = mode==14 ? uLights.z : uLights.w;
    emis = t.rgb*red*(uLights2.y*1.8 + uLights.y*5.5)*1.6 + vec3(1.0,0.45,0.03)*amb*blink*6.0 + vec3(1.0)*rev*uLights2.x*3.5;
    coat = 0.6;
  } else if (mode==17){
    alb = vec3(0.3,0.02,0.02); rough = 0.2;
    emis = vec3(1.0,0.05,0.02)*uLights.y*7.0;
  } else if (mode==13){
    alb = vec3(0.9); rough = 0.1;
    emis = vec3(1.0,0.93,0.8)*uLights.x*9.0;
  } else if (mode==6){
    alb = vec3(0.35,0.01,0.01); rough = 0.1;
    emis = vec3(1.0,0.04,0.02)*(uLights2.y*1.3 + uLights.y*6.0);
  } else if (mode==7){
    alb = vec3(0.6,0.3,0.02); rough = 0.1; emis = vec3(1.0,0.45,0.02)*uLights.z*7.0;
  } else if (mode==8){
    alb = vec3(0.6,0.3,0.02); rough = 0.1; emis = vec3(1.0,0.45,0.02)*uLights.w*7.0;
  } else if (mode==9){
    alb = vec3(0.7); rough = 0.1; emis = vec3(1.0)*uLights2.x*4.0;
  } else if (mode==11){
    // 地區霓虹 (檳榔攤)：常亮，夜間更亮
    emis = alb*(1.2 + night*4.0);
  }
  if (vExt.y > 0.0) emis += alb*vExt.y*(vExt.w > 0.5 ? night : 1.0);
  float sh = shadowFactor(vPos, n);
  vec3 c;
  if (uGlass > 0.5){
    vec3 V = normalize(uCamPos.xyz - vPos);
    float ndv = max(dot(n,V),0.0);
    float fres = 0.06 + 0.94*pow(1.0-ndv,5.0);
    vec3 R = reflect(-V,n);
    c = skyColorDir(R)*fres*1.1 + vec3(0.01,0.012,0.014);
    c += lightSurface(vec3(0.0), n, vPos, 0.04, 0.0, 1.0, sh, 0.0)*0.6;
    alpha = clamp(0.58 + fres*0.4, 0.0, 0.96);
  } else if (mode==3){
    // 車色零件 (後照鏡、尾翼…)：和車殼同一套兩層車漆
    c = carPaint(alb, n, vPos, uPaintMetal, vec4(0.5), 1.0, sh, length(fwidth(n))*1.6, 1.0);
  } else {
    c = lightSurface(alb, n, vPos, rough, metal, 1.0, sh, coat);
  }
  c += emis;
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), alpha);
}`;

  // ------------------------------------------------------------ 程序化車款的車殼 (貼圖投影 + 烤漆 + 車窗)
  // 投影座標由各車款以 uMapA..G 傳入 (見 proc_car.js 的 mapInfo)
  const carVS = HEAD + `
in vec3 aPos; in vec3 aNormal;
uniform mat4 uModel;
out vec3 vPos; out vec3 vN; out vec3 vLocal; out vec3 vNL;
void main(){
  vec4 wp = uModel*vec4(aPos,1.0);
  vPos = wp.xyz; vN = mat3(uModel)*aNormal; vNL = aNormal; vLocal = aPos;
  gl_Position = projWorld(wp.xyz);
}`;
  const carFS = HEAD + LIGHT + PAINT + `
in vec3 vPos; in vec3 vN; in vec3 vLocal; in vec3 vNL;
uniform sampler2D uCarA; uniform sampler2D uCarB; uniform sampler2D uCarC;
uniform mat4 uModel;
uniform vec3 uPaint; uniform vec4 uLights; uniform vec4 uLights2; uniform float uGlass; uniform float uDirt; uniform float uPaintMetal;
out vec4 oColor;
// uMapA = (XC, ZC, RC, UMAX)  uMapB = (Y0, Y1, Z0, Z1)  uMapC = (XMAX, 前軸z, 後軸z, 輪拱內側|x|)
// uMapD = (前輪拱半徑, 圓心高, 後輪拱半徑, 圓心高)  uMapE = (XCF, ZCF, RCF, 車頭角起點的 u)
uniform vec4 uMapA; uniform vec4 uMapB; uniform vec4 uMapC; uniform vec4 uMapD; uniform vec4 uMapE;
// 選用的正視投影 (中心 u、後界 z、外界 x、保桿頂高)。凹槽內壁與網格共用正視圖。
uniform vec4 uMapF;
// 車尾的同類投影 (啟用、前界 z、外界 x、尾燈面頂高)。
uniform vec4 uMapG;
// 環繞帶 u：由車尾中心沿水平輪廓繞過車尾角 → 車側 → 繞過車頭角 → 車頭中心的弧長
float wrapU(float ax, float z){
  float dz = z - uMapA.y;
  if (dz > 0.0) return min(ax, uMapA.x) + uMapA.z*atan(max(ax - uMapA.x, 0.0), dz);
  float df = uMapE.y - z;
  if (df <= 0.0) return uMapA.x + uMapA.z*1.5707963 - dz;
  return uMapE.w + uMapE.z*atan(df, max(ax - uMapE.x, 1e-4)) + max(uMapE.x - ax, 0.0);
}
vec3 safeN(vec3 v, vec3 alt){ float l = length(v); return l > 1e-3 ? v/l : alt; }
void main(){
  float ax = abs(vLocal.x); float sx = vLocal.x < 0.0 ? -1.0 : 1.0;
  vec3 nl = normalize(vNL);
  // ---- 兩個投影：環繞帶 (立面) 與俯視 (頂面)，依法線混合
  bool frontChart = uMapF.x > 0.0 && vLocal.z < uMapF.y && ax < uMapF.z;
  bool rearChart = uMapG.x > 0.0 && vLocal.z > uMapG.y && ax < uMapG.z;
  float uW = frontChart ? uMapF.x - ax : rearChart ? ax : wrapU(ax, vLocal.z);
  vec2 uvB = vec2(uW/uMapA.w, (uMapB.y - vLocal.y)/(uMapB.y - uMapB.x)*0.49);
  vec2 uvT = vec2((vLocal.z - uMapB.z)/(uMapB.w - uMapB.z), 1.0 - ax/uMapC.x*0.49);
  float wT = smoothstep(0.60, 0.74, nl.y);
  if (frontChart || rearChart) {
    float top = frontChart ? uMapF.w : uMapG.w;
    wT *= smoothstep(top, top + 0.045, vLocal.y);
  }
  vec4 A1 = texture(uCarA, uvB), A2 = texture(uCarA, uvT);
  vec4 B1 = texture(uCarB, uvB), B2 = texture(uCarB, uvT);
  vec4 C1 = texture(uCarC, uvB), C2 = texture(uCarC, uvT);
  float glassM = mix(C1.a, C2.a, wT);
  // ---- 輪拱開口
  if (ax > uMapC.w){
    float d1 = vLocal.z - uMapC.y, d2 = vLocal.z - uMapC.z;
    bool fr = abs(d1) < abs(d2);
    float dz = fr ? d1 : d2, aR = fr ? uMapD.x : uMapD.z, aY = fr ? uMapD.y : uMapD.w;
    if (vLocal.y < aY + aR && (vLocal.y > aY ? length(vec2(dz, vLocal.y - aY)) : abs(dz)) < aR) discard;
  }
  if (uGlass > 0.5) { if (glassM < 0.5) discard; } else if (glassM >= 0.5) discard;
  vec3 Bv = safeN(vec3(0.0,1.0,0.0) - nl*nl.y, vec3(0.0,0.0,1.0));
  vec3 Tu = cross(Bv, nl)*sx;
  // ---- 車燈：燈區 (C 的 rgb 有值) 的內層 —— 反射罩、燈珠、光條 —— 沿視線往內推一段深度再取樣 (視差)，
  //      轉動視角時內部會相對燈殼移動，看得出透鏡後面有深度；位移後跑出燈區的部分就是燈殼內壁 (深色)。
  //      深度 = C.a x 0.2 m (貼圖的 lens 值；沒給就是 3 cm)
  float lens = clamp((C1.r + C1.g + C1.b)*8.0, 0.0, 1.0)*(1.0 - wT);
  if (uGlass < 0.5 && lens > 0.01){
    vec3 Vl = normalize((uCamPos.xyz - vPos)*mat3(uModel));
    vec2 d2 = vec2(dot(Vl, Tu), dot(Vl, Bv))/max(dot(Vl, nl), 0.32)*(lens*(C1.a > 0.02 ? C1.a*0.2 : 0.03));
    vec2 uvI = uvB - vec2(d2.x/uMapA.w, -d2.y/(uMapB.y - uMapB.x)*0.49);
    vec4 Ci = texture(uCarC, uvI);
    float inl = clamp((Ci.r + Ci.g + Ci.b)*8.0, 0.0, 1.0), lw = smoothstep(0.02, 0.4, lens);
    A1 = mix(A1, mix(vec4(0.015,0.015,0.017,1.0), texture(uCarA, uvI), inl), lw);
    B1 = mix(B1, mix(vec4(0.50196,0.50196,0.7,0.0), texture(uCarB, uvI), inl), lw);
    // 燈珠本身 + 在燈殼內散開的光暈；夾在 1 以內 (超過 1 的話煞車燈的白熱核心項會把整片燈爆成白色)
    C1.rgb = mix(C1.rgb, min(Ci.rgb*inl + textureLod(uCarC, uvI, 3.5).rgb*0.25, vec3(1.0)), lw);
  }
  vec4 A = mix(A1, A2, wT), Bm = mix(B1, B2, wT);
  // ---- 凹凸貼圖 → 法線
  vec2 s1 = (B1.rg - 0.50196)*4.0, s2 = (B2.rg - 0.50196)*4.0;
  vec3 nB = normalize(nl - Tu*s1.x - Bv*s1.y);
  vec3 Tz = safeN(vec3(0.0,0.0,1.0) - nl*nl.z, vec3(0.0,1.0,0.0));
  vec3 Tx = safeN(vec3(1.0,0.0,0.0) - nl*nl.x, vec3(0.0,1.0,0.0))*sx;
  vec3 nT = normalize(nl - Tz*s2.x - Tx*s2.y);
  vec3 n = normalize(mat3(uModel)*normalize(mix(nB, nT, wT)));
  if (!gl_FrontFacing) n = -n;
  float sh = shadowFactor(vPos, n);
  float fzT = step(vLocal.z, 0.0);                        // 俯視投影：車頭那一半
  float brakeHi = C2.r*wT*uLights.y*(1.0 - fzT);          // 車尾那一半的 r = 第三煞車燈
  float lensT = clamp((C2.r + C2.g + C2.b)*8.0, 0.0, 1.0)*wT*fzT;   // 俯視投影裡的車頭燈 (繞上引擎蓋 / 葉子板斜面的部分)
  vec3 c; float alpha = 1.0;
  if (uGlass > 0.5){
    // ---- 車窗：深色隔熱紙 + 環境反射
    vec3 V = normalize(uCamPos.xyz - vPos);
    float ndv = max(dot(n,V),0.0);
    float fres = 0.05 + 0.95*pow(1.0-ndv,5.0);
    vec3 R = reflect(-V,n);
    c = carEnv(R)*fres + vec3(0.010,0.013,0.015)*(uSkyColor.rgb + uSunColor.rgb*0.08);
    vec3 Hh = normalize(uSunDir.xyz + V);
    c += uSunColor.rgb*min(pow(max(dot(n,Hh),0.0), 500.0)*6.0, 3.0)*sh;
    c += (headLight(vPos, n) + tailLight(vPos, n))*0.05;
    alpha = gl_FrontFacing ? clamp(0.8 + fres*0.19, 0.0, 0.98) : 0.08 + fres*0.25;
    vec3 det = A.rgb*(mix(uGroundColor.rgb, uSkyColor.rgb, 0.6) + uSunColor.rgb*0.25);
    c = mix(c, det, A.a); alpha = max(alpha, A.a);
    c += vec3(1.0,0.02,0.008)*brakeHi*4.0/uSunColor.w;
  } else {
    // ---- 車身：烤漆 (貼圖 alpha = 0，兩層車漆) 或貼圖材質 (飾板、燈具…)
    gTailK = 1.0 - lens;
    float slope = length(mix(s1, s2, wT));
    float ra = max(slope*0.45, length(fwidth(n))*1.3);          // 接縫斜面 / 小曲率處加粗糙度 (幾何反鋸齒)
    float ck = 1.0 - 0.8*smoothstep(0.25, 1.1, slope);
    float ao = mix(0.5, 1.0, smoothstep(0.14, 0.5, vLocal.y));
    float outside = gl_FrontFacing ? 1.0 : 0.0;
    gCarEnv = 1.0;
    if (!gl_FrontFacing){
      c = lightSurface(vec3(0.075,0.075,0.08), n, vPos, 0.92, 0.0, 0.8, sh, 0.0);   // 車內側：深色內裝
    } else {
      vec3 cp = vec3(0.0), cm = vec3(0.0);
      // 亮片座標：立面用環繞帶 (u, y)、頂面用俯視 (z, x)；導數在分支外先算好
      vec2 qs = vec2(uW, vLocal.y), qt = vLocal.zx;
      float fws = max(length(dFdx(qs)), length(dFdy(qs))), fwt = max(length(dFdx(qt)), length(dFdy(qt)));
      if (A.a < 0.996){
        vec4 flk = wT > 0.5 ? paintFlake(qt, fwt) : paintFlake(qs, fws);
        vec3 base = uPaint*(1.0 - uDirt*0.3*smoothstep(0.42, 0.16, vLocal.y));
        cp = carPaint(base, n, vPos, uPaintMetal, flk, ao, sh, ra, ck);
      }
      if (A.a > 0.004) cm = lightSurface(A.rgb, n, vPos, clamp(max(Bm.b, ra), 0.0, 1.0), Bm.a, ao, sh, max(lens, lensT)*ck);
      c = mix(cp, cm, A.a);
    }
    // ---- 燈光：尾燈/煞車燈、方向燈、倒車燈
    // 亮度以「曝光後」為準 (除以曝光值)，白天夜晚看起來一致，且保持飽和的紅色
    float w1 = (1.0 - wT)/uSunColor.w*outside;
    float blink = sx < 0.0 ? uLights.z : uLights.w;
    float tr = C1.r*(0.4 + 0.6*C1.r);
    // 1 = 車頭那一半 (z < 0)：頭燈繞到葉子板側面的部分也算車頭區 (以前只算車頭角之後，繞到車側的頭燈會被當成尾燈亮紅)
    float fzn = step(uMapA.x + uMapA.z*1.5707963 + uMapA.y, uW);
    // 車尾：尾燈 / 煞車燈、倒車燈
    c += vec3(1.0,0.014,0.006)*tr*(uLights2.y*1.7 + uLights.y*5.5)*w1*(1.0 - fzn);
    c += vec3(1.0,0.22,0.08)*pow(C1.r, 5.0)*uLights.y*1.6*w1*(1.0 - fzn);
    c += vec3(1.0,0.97,0.92)*C1.b*(0.4 + 0.6*C1.b)*uLights2.x*9.0*w1*(1.0 - fzn);
    // 車頭：頭燈、日行燈 (白天也亮，開大燈時更亮)
    c += vec3(1.0,0.96,0.88)*tr*uLights.x*14.0*w1*fzn;
    c += vec3(0.9,0.95,1.0)*C1.b*(0.4 + 0.6*C1.b)*(2.2 + uLights.x*3.0)*w1*fzn;
    // 方向燈 (前後相同)
    c += vec3(1.0,0.4,0.02)*C1.g*(0.4 + 0.6*C1.g)*blink*12.0*w1;
    c += vec3(1.0,0.02,0.008)*brakeHi*4.0/uSunColor.w;
    // 俯視投影的車頭燈：語意同環繞帶的車頭區 (r 頭燈、g 方向燈、b 日行燈)，沒有視差
    if (lensT > 0.0) c += (vec3(1.0,0.96,0.88)*C2.r*(0.4 + 0.6*C2.r)*uLights.x*14.0 + vec3(0.9,0.95,1.0)*C2.b*(0.4 + 0.6*C2.b)*(2.2 + uLights.x*3.0)
      + vec3(1.0,0.4,0.02)*C2.g*(0.4 + 0.6*C2.g)*blink*12.0)*wT*fzT*outside/uSunColor.w;
  }
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), alpha);
}`;


  // ------------------------------------------------------------ 胎痕 (路面上的深色橡膠痕)
  const skidVS = HEAD + `
in vec3 aPos; in vec3 aNormal; in vec2 aUV;
out vec3 vPos; out vec3 vN; out vec2 vUV;
void main(){ vPos = aPos; vN = aNormal; vUV = aUV; gl_Position = projWorld(aPos); }`;
  const skidFS = HEAD + LIGHT + `
in vec3 vPos; in vec3 vN; in vec2 vUV;
uniform sampler2D uNoise;
out vec4 oColor;
void main(){
  float u = vUV.x;
  // 兩側柔邊 + 胎紋溝 (較淡的縱向條紋) + 斑駁
  float edge = smoothstep(0.0, 0.2, u)*smoothstep(1.0, 0.8, u);
  float groove = 0.72 + 0.28*smoothstep(0.12, 0.3, abs(fract(u*3.0 + 0.5) - 0.5));
  float nz = texture(uNoise, vPos.xz*0.83).r*0.6 + texture(uNoise, vPos.xz*0.11).g*0.4;
  float a = clamp(vUV.y, 0.0, 1.0)*edge*groove*(0.78 + 0.4*nz);
  if (a < 0.004) discard;
  vec3 n = normalize(vN);
  float sh = shadowFactor(vPos, n);
  vec3 c = lightSurface(vec3(0.008,0.008,0.009), n, vPos, mix(0.8, 0.4, uSkyColor.w), 0.0, 1.0, sh, 0.0);
  c *= carShade(vPos);
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), min(a, 0.94));
}`;

  // ------------------------------------------------------------ instanced (樹 / 遠方建物 / 冥紙 / 茶樹)
  const instVS = HEAD + `
in vec3 aPos; in vec3 aNormal; in vec2 aUV; in vec4 aColor; in vec4 aExtra;
in vec4 iA; in vec4 iB; in vec4 iC;
uniform float uWind;
// uLodMode：0 = 一律畫、1 = 完整模型 (只畫近處)、2 = 簡化模型 (只畫遠處)、3 = 簡化模型一律畫
uniform float uLodMode; uniform vec2 uLodRange;
out vec3 vPos; out vec3 vN; out vec2 vUV; out vec4 vCol; out vec4 vExt; out float vFade; out float vLodM;
void main(){
  // 以整棵樹 (instance 原點) 的距離決定 LOD，整棵一起切換
  float lodM = smoothstep(uLodRange.x, uLodRange.y, distance(iA.xyz, uCamPos.xyz));
  vLodM = lodM;
  if ((uLodMode == 1.0 && lodM >= 1.0) || (uLodMode == 2.0 && lodM <= 0.0)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float c = cos(iA.w), s = sin(iA.w);
  vec3 p = aPos*iB.xyz;
  float t = uCamPos.w;
  float sway = aExtra.x*uWind;
  p.x += sway*sin(t*1.7 + iA.x*0.13 + iA.z*0.07)*0.08*max(aPos.y,0.0);
  p.z += sway*sin(t*1.3 + iA.z*0.11)*0.06*max(aPos.y,0.0);
  vec3 wp = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z) + iA.xyz;
  vec3 nn = aNormal;
  vN = vec3(c*nn.x + s*nn.z, nn.y, -s*nn.x + c*nn.z);
  vPos = wp; vUV = aUV; vCol = vec4(aColor.rgb*iC.rgb, aColor.a); vExt = aExtra;
  float dist = distance(wp, uCamPos.xyz);
  vFade = 1.0 - smoothstep(iC.w*0.8, iC.w, dist);
  gl_Position = projWorld(wp);
}`;

  const instFS = HEAD + LIGHT + `
in vec3 vPos; in vec3 vN; in vec2 vUV; in vec4 vCol; in vec4 vExt; in float vFade; in float vLodM;
uniform sampler2D uTex6;
uniform float uLeafMode;
uniform float uLodMode;
out vec4 oColor;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  // LOD 交叉淡入：同一像素只會由完整或簡化模型其中之一畫出
  if (uLodMode > 0.5 && uLodMode < 2.5){
    float hl = hash12(gl_FragCoord.xy + vec2(37.0, 11.0));
    if (uLodMode < 1.5 ? hl < vLodM : hl >= vLodM) discard;
  }
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 alb = vCol.rgb; float rough = vCol.a; float alpha = 1.0;
  if (vExt.y > 0.5){
    vec4 t = texture(uTex6, vUV);
    alpha = t.a;
    if (alpha < 0.35) discard;
    alb *= t.rgb;
  } else if (vExt.y < -0.5){
    alb *= texture(uTex6, vUV).rgb;
  }
  if (hash12(gl_FragCoord.xy) > vFade) discard;
  float sh = shadowFactor1(vPos, n);
  vec3 c = alb*(max(dot(n,uSunDir.xyz),0.0)*uSunColor.rgb*sh + mix(uGroundColor.rgb, uSkyColor.rgb, n.y*0.5+0.5)*0.85);
  c += (headLight(vPos, n) + tailLight(vPos, n))*alb;
  if (vExt.y > 0.5){
    // 葉片透光
    vec3 V = normalize(uCamPos.xyz - vPos);
    float tl = pow(max(dot(-V, uSunDir.xyz),0.0), 4.0);
    c += alb*uSunColor.rgb*sh*(0.25 + tl*0.9)*max(-dot(n,uSunDir.xyz)*0.5+0.5, 0.0)*0.6;
  }
  if (vExt.z > 0.0) c += alb*vExt.z*uSunDir.w*3.0;
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), 1.0);
}`;

  // ------------------------------------------------------------ sky
  const skyVS = `#version 300 es
out vec2 vNdc;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2))*2.0-1.0;
  vNdc = p; gl_Position = vec4(p, 0.99999, 1.0);
}`;
  const skyFS = HEAD + LIGHT + `
in vec2 vNdc;
uniform mat4 uInvVP;
uniform sampler2D uNoise;
uniform float uCloud;
out vec4 oColor;
void main(){
  vec4 a = uInvVP*vec4(vNdc, -1.0, 1.0); vec4 b = uInvVP*vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(b.xyz/b.w - a.xyz/a.w);
  float y = rd.y;
  vec3 col = mix(uSkyHorizon.rgb, uSkyZenith.rgb, pow(clamp(y,0.0,1.0), uSkyZenith.w > 0.0 ? uSkyZenith.w : 0.42));
  col = mix(col, uSkyHorizon.rgb*0.8, smoothstep(0.0,-0.2,y));
  float sd = max(dot(rd, uSunDir.xyz),0.0);
  col += uSunColor.rgb*(pow(sd,5.0)*0.08 + pow(sd,60.0)*0.3);
  col += uSunColor.rgb*smoothstep(0.99955,0.9998,sd)*(uGroundColor.w > 0.0 ? uGroundColor.w : 30.0)*(1.0-uFogParams.w);
  // 雲
  if (y > 0.0){
    vec2 uv = rd.xz/(y+0.06)*0.25 + vec2(uCamPos.w*0.0015, uCamPos.w*0.0006);
    float c1 = texture(uNoise, uv*0.35).r*0.55 + texture(uNoise, uv*0.9).g*0.3 + texture(uNoise, uv*2.3).b*0.15;
    float cov = smoothstep(1.0-uCloud, 1.25-uCloud*0.8, c1);
    float lit = 0.75 + 0.35*pow(sd, 4.0);
    vec3 cc = mix(uSkyHorizon.rgb*1.05, uSunColor.rgb*0.32 + uSkyColor.rgb*0.9, 0.5)*lit;
    cc = mix(cc, cc*0.6, smoothstep(0.5,1.0,c1));
    col = mix(col, cc, cov*smoothstep(0.0,0.12,y)*0.9);
  }
  col = mix(col, uFogColor.rgb, clamp(uFogParams.w + pow(1.0-abs(y), 10.0)*0.5*uFogColor.w*400.0, 0.0, 1.0));
  // 夜空星星
  if (uSunDir.w > 0.5 && y > 0.05){
    vec2 g = floor(rd.xz/(y+0.3)*400.0);
    float h = fract(sin(dot(g, vec2(12.9898,78.233)))*43758.5453);
    col += vec3(step(0.9985, h))*0.6*(1.0-uFogParams.w)*smoothstep(0.05,0.3,y);
  }
  oColor = vec4(finalColor(col), 1.0);
}`;

  // ------------------------------------------------------------ water (海)
  const waterVS = HEAD + `
in vec3 aPos; in vec2 aUV;
out vec3 vPos; out vec2 vShore;
void main(){ vPos = aPos; vShore = aUV; gl_Position = projWorld(aPos); }`;
  const waterFS = HEAD + LIGHT + `
in vec3 vPos; in vec2 vShore;
uniform sampler2D uNoise;
out vec4 oColor;
void main(){
  float t = uCamPos.w;
  vec2 p = vPos.xz;
  float dist = distance(vPos, uCamPos.xyz);
  vec2 p1 = mat2(0.866, 0.5, -0.5, 0.866)*p, p2 = mat2(0.94, -0.342, 0.342, 0.94)*p;
  vec4 a = texture(uNoise, p1*0.0071 + vec2(t*0.003, t*0.0015));
  vec4 b = texture(uNoise, p2*0.0223 - vec2(t*0.005, -t*0.002));
  vec4 c2 = texture(uNoise, p*0.0617 + vec2(t*0.008, t*0.004));
  float amp = mix(1.0, 0.25, smoothstep(300.0, 4000.0, dist));
  vec3 n = normalize(vec3(((a.r-0.5)*0.22 + (b.g-0.5)*0.14 + (c2.b-0.5)*0.08)*amp, 1.0, ((a.g-0.5)*0.22 + (b.r-0.5)*0.14 + (c2.r-0.5)*0.08)*amp));
  vec3 V = normalize(uCamPos.xyz - vPos);
  float ndv = max(dot(n,V),0.0);
  float fres = 0.02 + 0.98*pow(1.0-ndv,5.0);
  vec3 R = reflect(-V, n);
  vec3 deep = vec3(0.01,0.05,0.07);
  vec3 c = deep*(mix(uGroundColor.rgb, uSkyColor.rgb, 0.7)*2.0 + uSunColor.rgb*0.1);
  c = mix(c, skyColorDir(R), fres);
  vec3 H = normalize(uSunDir.xyz + V);
  c += uSunColor.rgb*pow(max(dot(n,H),0.0), 300.0)*3.0;
  // 淺灘與浪花：只有虛構賽道的海有 (頂點的 aUV.x = 淺水程度 0～1；北宜的海沒有這個屬性，固定是 0)
  float sh = vShore.x;
  if (sh > 0.001){
    vec3 amb = uSunColor.rgb*max(uSunDir.y, 0.0)*0.8 + mix(uGroundColor.rgb, uSkyColor.rgb, 0.75)*1.3;
    c = mix(c, vec3(0.1, 0.52, 0.48)*amb, sh*sh*(1.0 - fres)*0.9);
    float swell = sin(t*1.2 - sh*16.0 + (a.r - 0.5)*7.0 + (b.g - 0.5)*5.0);
    float foam = smoothstep(0.9, 0.99, sh) + smoothstep(0.55, 1.0, swell)*smoothstep(0.55, 0.85, sh)*(1.0 - smoothstep(0.93, 0.99, sh))*0.7;
    c = mix(c, vec3(0.95)*amb*1.15, clamp(foam*(0.55 + 0.45*c2.b), 0.0, 1.0));
  }
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), 1.0);
}`;

  // ------------------------------------------------------------ shadow
  const shadowVS = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP; uniform mat4 uModel;
void main(){ gl_Position = uLightVP*uModel*vec4(aPos,1.0); }`;
  const shadowInstVS = `#version 300 es
in vec3 aPos; in vec2 aUV; in vec4 aExtra; in vec4 iA; in vec4 iB;
uniform mat4 uLightVP;
uniform vec4 uShLod;    // xyz = 玩家車位置、w = 換成簡化模型的距離
uniform float uLodMode; // 0 一律畫、1 完整模型只畫近處、2 簡化模型只畫遠處、3 簡化模型一律畫
out vec2 vUV; out float vLeaf;
void main(){
  float dc = distance(iA.xz, uShLod.xz);
  if ((uLodMode == 1.0 && dc >= uShLod.w) || (uLodMode == 2.0 && dc < uShLod.w)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUV = vec2(0.0); vLeaf = 0.0; return; }
  float c = cos(iA.w), s = sin(iA.w);
  vec3 p = aPos*iB.xyz;
  vec3 wp = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z) + iA.xyz;
  vUV = aUV; vLeaf = aExtra.y;
  gl_Position = uLightVP*vec4(wp,1.0);
}`;
  const shadowFS = `#version 300 es
precision mediump float;
in vec2 vUV; in float vLeaf;
uniform sampler2D uTex6;
uniform float uUseAlpha;
out vec4 o;
void main(){
  if (uUseAlpha > 0.5 && vLeaf > 0.5 && texture(uTex6, vUV).a < 0.4) discard;
  o = vec4(1.0);
}`;
  const shadowPlainFS = `#version 300 es
precision mediump float;
out vec4 o;
void main(){ o = vec4(1.0); }`;

  // ------------------------------------------------------------ particles (輪胎煙/塵土)
  const partVS = HEAD + `
in vec2 aUV; in vec4 iA; in vec4 iB;
out vec2 vUV; out vec4 vP; out vec3 vPos;
void main(){
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  float c = cos(iB.z), s = sin(iB.z);
  vec2 q = (aUV-0.5)*2.0;
  q = vec2(c*q.x - s*q.y, s*q.x + c*q.y);
  vec3 wp = iA.xyz + (right*q.x + up*q.y)*iA.w;
  vUV = aUV; vP = iB; vPos = wp;
  gl_Position = projWorld(wp);
}`;
  const partFS = HEAD + LIGHT + `
in vec2 vUV; in vec4 vP; in vec3 vPos;
uniform sampler2D uNoise;
out vec4 oColor;
void main(){
  vec2 q = vUV-0.5;
  float r = length(q)*2.0;
  float nse = texture(uNoise, vUV*0.6 + vP.z*0.1).r;
  float a = (1.0 - smoothstep(0.2, 1.0, r + (nse-0.5)*0.5))*vP.x;
  if (a < 0.003) discard;
  vec3 base = vP.w > 0.5 ? vec3(0.45,0.38,0.28) : vec3(0.75);
  vec3 c = base*vP.y*(mix(uGroundColor.rgb, uSkyColor.rgb, 0.7) + uSunColor.rgb*0.55);
  c = applyFog(c, vPos);
  oColor = vec4(finalColor(c), a);
}`;

  // ------------------------------------------------------------ glow sprites (夜間燈光)
  const glowVS = HEAD + `
in vec2 aUV; in vec4 iA; in vec4 iB;
out vec2 vUV; out vec4 vC; out vec3 vPos;
void main(){
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec2 q = (aUV-0.5)*2.0;
  vec3 wp = iA.xyz + (right*q.x + up*q.y)*iA.w;
  // 往相機推一點避免被燈罩遮住
  vec3 toCam = normalize(uCamPos.xyz - iA.xyz);
  wp += toCam*min(iA.w*0.5, 0.6);
  vUV = aUV; vC = iB; vPos = iA.xyz;
  gl_Position = projWorld(wp);
}`;
  const glowFS = HEAD + LIGHT + `
in vec2 vUV; in vec4 vC; in vec3 vPos;
out vec4 oColor;
void main(){
  float r = length(vUV-0.5)*2.0;
  float g = exp(-r*r*7.0) + exp(-r*r*60.0)*1.5;
  if (g < 0.002) discard;
  float dist = distance(vPos, uCamPos.xyz);
  vec3 c = vC.rgb*vC.w*g;
  // 霧中光暈衰減
  float f = exp(-dist*uFogColor.w*0.8);
  oColor = vec4(c*f*uSunColor.w*0.5, 1.0);
}`;

  // Garage only: transparent contact shadow and open-ended light rails, no solid pedestal.
  const studioGroundVS = HEAD + `
in vec3 aPos; out vec2 vGround;
void main(){ vGround = aPos.xz; gl_Position = projWorld(aPos); }
`;
  const studioGroundFS = `#version 300 es
precision highp float;
in vec2 vGround; out vec4 oColor;
void main(){
  vec2 p = abs(vGround);
  float shadow = exp(-pow(p.x / 1.05, 4.0) - pow(p.y / 2.28, 6.0)) * 0.66;
  float edge = abs(p.x - 1.25);
  float aa = max(fwidth(edge), 0.003);
  float ends = 1.0 - smoothstep(2.25, 2.7, p.y);
  float rail = (1.0 - smoothstep(0.008, 0.008 + aa, edge)) * ends;
  float glow = exp(-edge * edge * 300.0) * ends * 0.13;
  float capEdge = abs(p.y - 2.43);
  float cap = (1.0 - smoothstep(0.012, 0.012 + max(fwidth(capEdge), 0.003), capEdge))
    * smoothstep(0.83, 0.88, p.x) * (1.0 - smoothstep(1.25, 1.27, p.x));
  float light = clamp(rail * 0.64 + cap * 0.8 + glow, 0.0, 0.9);
  float alpha = light + shadow * (1.0 - light);
  if (alpha < 0.002) discard;
  vec3 color = (vec3(0.78, 0.93, 0.57) * light + vec3(0.015, 0.025, 0.025) * shadow * (1.0 - light)) / alpha;
  oColor = vec4(color, alpha);
}`;

  // ------------------------------------------------------------ 後製：離屏畫面 → 畫布 (FXAA 或直接複製，含解析度縮放)
  const postVS = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2))*2.0-1.0;
  vUV = p*0.5+0.5; gl_Position = vec4(p, 0.0, 1.0);
}`;
  // uUVScale：動態解析度時只畫了貼圖左下角這個比例的區域；uUVMax：取樣不超出該區域
  const copyFS = `#version 300 es
precision mediump float;
in vec2 vUV; uniform sampler2D uAlbedo; uniform vec2 uUVScale; out vec4 o;
void main(){ o = texture(uAlbedo, vUV*uUVScale); }`;
  // FXAA (Lottes 簡化版)：以亮度梯度找出邊緣方向，沿邊緣取樣混合
  const fxaaFS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uAlbedo; uniform vec2 uTexel; uniform vec2 uUVScale; uniform vec2 uUVMax; out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 tx(vec2 p){ return texture(uAlbedo, min(p, uUVMax)); }
void main(){
  vec2 uv = vUV*uUVScale;
  vec4 cNW = tx(uv + vec2(-1.0,-1.0)*uTexel);
  vec4 cNE = tx(uv + vec2( 1.0,-1.0)*uTexel);
  vec4 cSW = tx(uv + vec2(-1.0, 1.0)*uTexel);
  vec4 cSE = tx(uv + vec2( 1.0, 1.0)*uTexel);
  vec4 cM = tx(uv);
  float lNW = luma(cNW.rgb), lNE = luma(cNE.rgb), lSW = luma(cSW.rgb), lSE = luma(cSE.rgb), lM = luma(cM.rgb);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax*0.125)) { o = cM; return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE)*(0.25/8.0), 1.0/128.0);
  float rcp = 1.0/(min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir*rcp, vec2(-8.0), vec2(8.0))*uTexel;
  vec4 cA = 0.5*(tx(uv + dir*(1.0/3.0 - 0.5)) + tx(uv + dir*(2.0/3.0 - 0.5)));
  vec4 cB = cA*0.5 + 0.25*(tx(uv - dir*0.5) + tx(uv + dir*0.5));
  float lB = luma(cB.rgb);
  o = (lB < lMin || lB > lMax) ? cA : cB;
}`;

  RM.SHADERS = {
    copy: [postVS, copyFS], fxaa: [postVS, fxaaFS],
    terrain: [terrainVS, terrainFS], road: [roadVS, roadFS], prop: [propVS, propFS],
    inst: [instVS, instFS], sky: [skyVS, skyFS], water: [waterVS, waterFS],
    shadow: [shadowVS, shadowPlainFS], shadowInst: [shadowInstVS, shadowFS],
    part: [partVS, partFS], glow: [glowVS, glowFS], car: [carVS, carFS], skid: [skidVS, skidFS],
    studioGround: [studioGroundVS, studioGroundFS],
  };
})();
