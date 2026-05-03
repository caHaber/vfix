/**
 * Shader sources for the glyph atlas renderer.
 *
 * Per-instance attributes (one quad per glyph):
 *   aQuadCorner   : vec2  — base-quad corner (0,0)..(1,1), repeated for each instance
 *   aPosSize      : vec4  — (penX, penY, glyphW, glyphH) in CSS px relative to canvas origin
 *   aUvLo         : vec4  — (u0, v0, uw, vh) for the low-bucket sample, normalized [0,1]
 *   aUvHi         : vec4  — same for high-bucket
 *   aBlendT       : float — [0,1] cross-bucket blend coefficient
 *   aColor        : vec4  — RGBA, premultiplied or straight (we use straight + multiply alpha)
 *
 * Uniforms:
 *   uViewport     : vec2  — viewport in CSS px (width, height)
 *   uAtlas        : sampler2D — R8 atlas texture
 *
 * Convention: y in CSS px grows downward. We flip into clip space (-1..1, +y up).
 */

export const VERT_SRC = `#version 300 es
precision highp float;

in vec2 aQuadCorner;
in vec4 aPosSize;
in vec4 aUvLo;
in vec4 aUvHi;
in float aBlendT;
in vec4 aColor;

uniform vec2 uViewport;

out vec2 vUvLo;
out vec2 vUvHi;
out float vBlendT;
out vec4 vColor;

void main() {
  // CSS px → clip space. y flips because CSS goes down, GL goes up.
  vec2 px = aPosSize.xy + aQuadCorner * aPosSize.zw;
  vec2 clip = vec2(
    (px.x / uViewport.x) * 2.0 - 1.0,
    1.0 - (px.y / uViewport.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);

  vUvLo = aUvLo.xy + aQuadCorner * aUvLo.zw;
  vUvHi = aUvHi.xy + aQuadCorner * aUvHi.zw;
  vBlendT = aBlendT;
  vColor = aColor;
}
`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUvLo;
in vec2 vUvHi;
in float vBlendT;
in vec4 vColor;

uniform sampler2D uAtlas;

out vec4 fragColor;

void main() {
  float aLo = texture(uAtlas, vUvLo).r;
  float aHi = texture(uAtlas, vUvHi).r;
  float a   = mix(aLo, aHi, vBlendT);
  fragColor = vec4(vColor.rgb, vColor.a * a);
}
`;
