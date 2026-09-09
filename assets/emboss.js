/* Embossed wordmark.
   Vanilla WebGL port of the emboss playground. The plaster and grunge
   surfaces are synthesized at load time, so this needs no image assets.
   Any element with [data-emboss] gets a canvas; if WebGL is missing the
   element's own text stays visible untouched. */
(function () {
"use strict";

var TEX = 512;
var MAX_FIELD_W = 1500;
var GRUNGE_AMT = 0.3;

/* Press preset, retuned for cream paper: shallow bevel, low grain,
   tint matched to --paper so the canvas edge disappears into the page. */
var PARAMS = {
  depth: 0.78,
  size: 2.6,
  soften: 0.7,
  angle: 73,
  altitude: 21,
  highlight: 0.22,
  shadow: 0.26,
  contrast: 0.22,
  bright: 2.0,
  tint: [0.949, 0.925, 0.878],
  texOffset: [0.4, 0.15],
  texScale: 1.0
};

var VERT = `
attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUV;
void main(){ vUV = aUV; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

var FRAG = `
precision highp float;
varying vec2 vUV;

uniform sampler2D uField;
uniform sampler2D uPlaster;
uniform sampler2D uGrunge;
uniform float uGrungeAmt;
uniform vec2  uTexel;
uniform vec2  uLight;
uniform float uLightZ;
uniform float uDepth;
uniform float uHi;
uniform float uSh;
uniform float uContrast;
uniform float uBright;
uniform vec3  uTint;
uniform vec2  uTexOff;
uniform float uTexScale;
uniform float uReveal;

void main(){
  vec2 uv = vUV;

  float gs = 1.0;
  float hL = texture2D(uField, uv - vec2(gs,0.0)*uTexel).g;
  float hR = texture2D(uField, uv + vec2(gs,0.0)*uTexel).g;
  float hD = texture2D(uField, uv - vec2(0.0,gs)*uTexel).g;
  float hU = texture2D(uField, uv + vec2(0.0,gs)*uTexel).g;
  float crisp = texture2D(uField, uv).r;
  vec2 slope = vec2(hR-hL, hU-hD) * uDepth * 16.0 * uReveal;
  vec3 N = normalize(vec3(-slope.x, -slope.y, 1.0));
  float bevel = clamp(length(slope), 0.0, 1.0);

  vec3 L = normalize(vec3(uLight, uLightZ));
  float diff = dot(N, L);
  float hi = pow(max(diff,0.0), 1.2) * bevel;
  float sh = pow(max(-diff,0.0), 1.0) * bevel;

  float zoom = max(1.0, uTexScale);
  vec2 span = vec2(1.0 / zoom);
  vec2 origin = clamp(uTexOff, 0.0, 1.0) * (1.0 - span);
  vec2 puv = origin + uv * span;
  float p = texture2D(uPlaster, puv).r;
  p = clamp((p-0.5)*uContrast + 0.5, 0.0, 1.0);
  vec3 base = uTint * p * uBright;

  float face = smoothstep(0.4, 0.62, crisp);
  base *= mix(1.0, 0.86, face * uReveal);

  vec3 c = base;
  c += hi * uHi * uReveal;
  c -= sh * uSh * uReveal;

  float gr = texture2D(uGrunge, uv).r;
  vec3 ov = mix(2.0*c*gr, 1.0-2.0*(1.0-c)*(1.0-gr), step(0.5, c));
  c = mix(c, ov, uGrungeAmt);

  gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);
}
`;

/* ---------- noise ---------- */

function hash2(x, y, seed) {
  var n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, seed) {
  var xi = Math.floor(x), yi = Math.floor(y);
  var xf = x - xi, yf = y - yi;
  var u = smooth(xf), v = smooth(yf);
  var a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  var c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, octaves, seed) {
  var sum = 0, amp = 0.5, norm = 0;
  for (var i = 0; i < octaves; i++) {
    sum += valueNoise(x, y, seed + i * 17) * amp;
    norm += amp;
    x *= 2; y *= 2; amp *= 0.5;
  }
  return sum / norm;
}

function grayCanvas(size, fn) {
  var c = document.createElement("canvas");
  c.width = size; c.height = size;
  var ctx = c.getContext("2d");
  var img = ctx.createImageData(size, size);
  var d = img.data;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var v = fn(x / size, y / size);
      var b = v < 0 ? 0 : v > 1 ? 255 : Math.round(v * 255);
      var i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* Laid paper: stretched fibers, fine tooth, slow mottle. Mean 0.5 so the
   shader's contrast pivot leaves the tint unshifted. */
function makePlaster() {
  return grayCanvas(TEX, function (fx, fy) {
    var fiber = fbm(fx * 190, fy * 70, 3, 11);
    var tooth = fbm(fx * 320, fy * 320, 2, 29);
    var mottle = fbm(fx * 6, fy * 6, 4, 53);
    return 0.5 + (fiber - 0.5) * 0.34 + (tooth - 0.5) * 0.28 + (mottle - 0.5) * 0.22;
  });
}

/* Age: broad blotching plus sparse foxing specks. */
function makeGrunge() {
  return grayCanvas(TEX, function (fx, fy) {
    var blot = fbm(fx * 3.5, fy * 3.5, 5, 71);
    var v = 0.5 + (blot - 0.5) * 0.5;
    var speck = valueNoise(fx * 220, fy * 220, 97);
    if (speck > 0.94) v -= (speck - 0.94) * 3.2;
    return v;
  });
}

/* ---------- content field ---------- */

function boxPass(src, dst, w, h, r, horizontal) {
  var len = horizontal ? w : h;
  var lines = horizontal ? h : w;
  var stride = horizontal ? 1 : w;
  var lineStep = horizontal ? w : 1;
  var norm = 1 / (2 * r + 1);
  var last = len - 1;
  for (var j = 0; j < lines; j++) {
    var base = j * lineStep;
    var sum = 0;
    for (var k = -r; k <= r; k++) {
      var s = k < 0 ? 0 : k > last ? last : k;
      sum += src[base + s * stride];
    }
    for (var i = 0; i < len; i++) {
      dst[base + i * stride] = sum * norm;
      var out = i - r; out = out < 0 ? 0 : out > last ? last : out;
      var inn = i + r + 1; inn = inn < 0 ? 0 : inn > last ? last : inn;
      sum += src[base + inn * stride] - src[base + out * stride];
    }
  }
}

/* Three box passes approximate a Gaussian of sigma ~= r. Done by hand
   rather than ctx.filter so the bevel is identical in every browser. */
function blurAlpha(a, w, h, r) {
  if (r < 1) return a;
  var src = a, dst = new Float32Array(w * h), t;
  for (var p = 0; p < 3; p++) {
    boxPass(src, dst, w, h, r, true);
    t = src; src = dst; dst = t;
    boxPass(src, dst, w, h, r, false);
    t = src; src = dst; dst = t;
  }
  return src;
}

function trackedWidth(ctx, text, trackPx) {
  var w = 0;
  for (var i = 0; i < text.length; i++) w += ctx.measureText(text.charAt(i)).width;
  return w + trackPx * (text.length - 1);
}

/* R = crisp coverage (the letter face), G = blurred coverage (the height
   field the shader differentiates into a normal). */
function buildField(text, tracking, blurPx, W, H, font) {
  var crisp = document.createElement("canvas");
  crisp.width = W; crisp.height = H;
  var cx = crisp.getContext("2d");
  cx.clearRect(0, 0, W, H);
  cx.fillStyle = "#fff";
  cx.textBaseline = "middle";
  cx.textAlign = "left";

  var size = H * 0.52;
  cx.font = "700 " + size + "px " + font;
  var trackPx = tracking * size;
  var w = trackedWidth(cx, text, trackPx);
  var maxW = W * 0.86;
  if (w > maxW) {
    size *= maxW / w;
    cx.font = "700 " + size + "px " + font;
    trackPx = tracking * size;
    w = trackedWidth(cx, text, trackPx);
  }

  var x = (W - w) / 2;
  var y = H / 2;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    cx.fillText(ch, x, y);
    x += cx.measureText(ch).width + trackPx;
  }

  var src = cx.getImageData(0, 0, W, H).data;
  var n = W * H;
  var alpha = new Float32Array(n);
  for (var j = 0; j < n; j++) alpha[j] = src[j * 4 + 3];
  var soft = blurAlpha(alpha, W, H, Math.round(blurPx));

  var out = document.createElement("canvas");
  out.width = W; out.height = H;
  var ox = out.getContext("2d");
  var packed = ox.createImageData(W, H);
  var p = packed.data;
  for (var m = 0; m < n; m++) {
    var s = soft[m];
    p[m * 4] = src[m * 4 + 3];
    p[m * 4 + 1] = s < 0 ? 0 : s > 255 ? 255 : s;
    p[m * 4 + 2] = 0;
    p[m * 4 + 3] = 255;
  }
  ox.putImageData(packed, 0, 0);
  return out;
}

/* ---------- engine ---------- */

function Emboss(host) {
  this.host = host;
  this.text = host.getAttribute("data-emboss") || "";
  this.tracking = parseFloat(host.getAttribute("data-emboss-tracking"));
  if (isNaN(this.tracking)) this.tracking = 0.06;
  this.ok = false;

  this.canvas = document.createElement("canvas");
  this.canvas.className = "emboss-canvas";
  this.canvas.setAttribute("aria-hidden", "true");
  host.appendChild(this.canvas);

  var gl = this.canvas.getContext("webgl", {
    alpha: false, antialias: false, premultipliedAlpha: false
  });
  if (!gl) { this.canvas.remove(); return; }
  this.gl = gl;
  gl.clearColor(1, 1, 1, 1);

  try { this.prog = this.build(VERT, FRAG); }
  catch (e) { this.canvas.remove(); this.gl = null; return; }

  var uniforms = ["uField", "uPlaster", "uGrunge", "uGrungeAmt", "uTexel",
    "uLight", "uLightZ", "uDepth", "uHi", "uSh", "uContrast", "uBright",
    "uTint", "uTexOff", "uTexScale", "uReveal"];
  this.loc = {};
  for (var i = 0; i < uniforms.length; i++) {
    this.loc[uniforms[i]] = gl.getUniformLocation(this.prog, uniforms[i]);
  }

  var aPos = gl.getAttribLocation(this.prog, "aPosition");
  var aUV = gl.getAttribLocation(this.prog, "aUV");
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0
  ]), gl.STATIC_DRAW);
  gl.useProgram(this.prog);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

  this.field = gl.createTexture();
  this.plaster = this.upload(makePlaster());
  this.grunge = this.upload(makeGrunge());
  this.fieldW = 1;
  this.fieldH = 1;
  this.sized = false;
  this.ok = true;
}

Emboss.prototype.build = function (vs, fs) {
  var gl = this.gl;
  function compile(type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "compile");
    }
    return sh;
  }
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "link");
  }
  return p;
};

Emboss.prototype.upload = function (source) {
  var gl = this.gl;
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
};

/* Sizes the canvas to the host. Returns true when the field needs recutting. */
Emboss.prototype.layout = function () {
  var r = this.host.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var cw = Math.round(r.width * dpr);
  var ch = Math.round(r.height * dpr);
  this.dpr = dpr;
  this.w = r.width;
  this.h = r.height;
  if (cw === this.canvas.width && ch === this.canvas.height && this.sized) return false;
  this.canvas.width = cw;
  this.canvas.height = ch;
  this.gl.viewport(0, 0, cw, ch);
  this.sized = true;
  return true;
};

Emboss.prototype.rebuild = function () {
  if (!this.ok || !this.text) return;
  var gl = this.gl;
  var mw = Math.max(2, Math.min(MAX_FIELD_W, Math.round(this.w * this.dpr)));
  var mh = Math.max(2, Math.round(mw * (this.h / Math.max(1, this.w))));
  var blur = Math.max(1, (PARAMS.size + PARAMS.soften) * this.dpr * 1.2);
  var font = window.getComputedStyle(this.host).fontFamily || "monospace";

  var art = buildField(this.text, this.tracking, blur, mw, mh, font);
  gl.bindTexture(gl.TEXTURE_2D, this.field);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
  this.fieldW = art.width;
  this.fieldH = art.height;
  this.render();
};

Emboss.prototype.render = function () {
  var gl = this.gl, p = PARAMS, L = this.loc;
  if (!gl || !this.prog) return;
  var a = (p.angle * Math.PI) / 180;
  var lz = Math.max(0.25, Math.sin((p.altitude * Math.PI) / 180) + 0.3);

  gl.useProgram(this.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.field);
  gl.uniform1i(L.uField, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, this.plaster);
  gl.uniform1i(L.uPlaster, 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, this.grunge);
  gl.uniform1i(L.uGrunge, 2);
  gl.uniform1f(L.uGrungeAmt, GRUNGE_AMT);
  gl.uniform2f(L.uTexel, 1 / this.fieldW, 1 / this.fieldH);
  gl.uniform2f(L.uLight, Math.cos(a), Math.sin(a));
  gl.uniform1f(L.uLightZ, lz);
  gl.uniform1f(L.uDepth, p.depth);
  gl.uniform1f(L.uHi, p.highlight);
  gl.uniform1f(L.uSh, p.shadow);
  gl.uniform1f(L.uContrast, p.contrast);
  gl.uniform1f(L.uBright, p.bright);
  gl.uniform3f(L.uTint, p.tint[0], p.tint[1], p.tint[2]);
  gl.uniform2f(L.uTexOff, p.texOffset[0], p.texOffset[1]);
  gl.uniform1f(L.uTexScale, p.texScale);
  gl.uniform1f(L.uReveal, 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  this.host.setAttribute("data-embossed", "1");
};

/* ---------- boot ---------- */

function start() {
  var hosts = document.querySelectorAll("[data-emboss]");
  var live = [];
  for (var i = 0; i < hosts.length; i++) {
    var e = new Emboss(hosts[i]);
    if (e.ok && e.layout()) { e.rebuild(); live.push(e); }
  }
  if (!live.length) return;

  var redraw = function () {
    for (var j = 0; j < live.length; j++) {
      if (live[j].layout()) live[j].rebuild();
    }
  };

  /* The mask is typeset in the page font; recut it once the webfont lands. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      for (var j = 0; j < live.length; j++) live[j].rebuild();
    });
  }

  var t = 0;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(redraw, 150);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

})();
