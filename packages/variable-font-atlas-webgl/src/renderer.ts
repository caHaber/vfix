import type { GlyphAtlas } from '@variable-font/atlas';
import { FRAG_SRC, VERT_SRC } from './shaders.js';
import { FLOATS_PER_INSTANCE } from './types.js';

export interface AtlasRendererOptions {
	canvas: HTMLCanvasElement;
	atlas: GlyphAtlas;
	/** Initial capacity in glyphs. The buffer grows as needed. */
	initialCapacity?: number;
}

/**
 * Single-draw-call instanced glyph renderer. Holds:
 *   - A WebGL2 context bound to the supplied canvas.
 *   - A program built from shaders.ts.
 *   - One R8 atlas texture mirroring the GlyphAtlas pixel buffer.
 *   - One static unit-quad VBO (4 verts, drawArraysInstanced over them).
 *   - One dynamic per-instance VBO holding [posSize, uvLo, uvHi, blendT, color].
 *
 * Each `draw(...)` call:
 *   1. Flushes the atlas's dirty regions to the GL texture (texSubImage2D).
 *   2. Uploads the per-instance VBO with the supplied glyph data.
 *   3. Issues a single drawArraysInstanced call (4 verts × N instances).
 */
export class AtlasRenderer {
	readonly canvas: HTMLCanvasElement;
	readonly atlas: GlyphAtlas;

	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private texture: WebGLTexture;
	private vao: WebGLVertexArrayObject;
	private quadBuffer: WebGLBuffer;
	private instanceBuffer: WebGLBuffer;
	private instanceCapacity: number;
	private instanceCpu: Float32Array;
	private uViewportLoc: WebGLUniformLocation | null;
	private uAtlasLoc: WebGLUniformLocation | null;

	private viewportCssWidth = 0;
	private viewportCssHeight = 0;
	private dpr = 1;

	private lostHandler = (e: Event) => {
		e.preventDefault();
	};
	private restoredHandler = () => {
		this.rebuildAfterContextLoss();
	};

	constructor(opts: AtlasRendererOptions) {
		this.canvas = opts.canvas;
		this.atlas = opts.atlas;
		const gl = opts.canvas.getContext('webgl2', {
			alpha: true,
			antialias: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
		});
		if (!gl) throw new Error('WebGL2 is required for the kinetic atlas renderer');
		this.gl = gl;

		this.canvas.addEventListener('webglcontextlost', this.lostHandler);
		this.canvas.addEventListener('webglcontextrestored', this.restoredHandler);

		this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);
		this.uViewportLoc = gl.getUniformLocation(this.program, 'uViewport');
		this.uAtlasLoc = gl.getUniformLocation(this.program, 'uAtlas');

		this.texture = createAtlasTexture(gl, this.atlas.textureSize);
		this.atlas.markFullyDirty();

		const vao = gl.createVertexArray();
		if (!vao) throw new Error('Failed to allocate VAO');
		this.vao = vao;
		gl.bindVertexArray(vao);

		this.quadBuffer = createQuadBuffer(gl);
		const aQuadCornerLoc = gl.getAttribLocation(this.program, 'aQuadCorner');
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.enableVertexAttribArray(aQuadCornerLoc);
		gl.vertexAttribPointer(aQuadCornerLoc, 2, gl.FLOAT, false, 0, 0);

		this.instanceCapacity = opts.initialCapacity ?? 4096;
		this.instanceCpu = new Float32Array(this.instanceCapacity * FLOATS_PER_INSTANCE);
		const instanceBuffer = gl.createBuffer();
		if (!instanceBuffer) throw new Error('Failed to allocate instance buffer');
		this.instanceBuffer = instanceBuffer;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.instanceCpu.byteLength, gl.DYNAMIC_DRAW);
		this.bindInstanceAttribs();

		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	destroy(): void {
		this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
		this.canvas.removeEventListener('webglcontextrestored', this.restoredHandler);
		const gl = this.gl;
		gl.deleteProgram(this.program);
		gl.deleteTexture(this.texture);
		gl.deleteBuffer(this.quadBuffer);
		gl.deleteBuffer(this.instanceBuffer);
		gl.deleteVertexArray(this.vao);
	}

	resize(cssWidth: number, cssHeight: number, dpr: number): void {
		this.viewportCssWidth = cssWidth;
		this.viewportCssHeight = cssHeight;
		this.dpr = dpr;
		const pxW = Math.max(1, Math.round(cssWidth * dpr));
		const pxH = Math.max(1, Math.round(cssHeight * dpr));
		if (this.canvas.width !== pxW) this.canvas.width = pxW;
		if (this.canvas.height !== pxH) this.canvas.height = pxH;
	}

	/**
	 * Issue one draw call for `instanceCount` glyphs whose attributes have
	 * been written into the renderer's `instanceCpu` Float32Array via
	 * `getInstanceCpu()` + `ensureCapacity()`.
	 */
	draw(instanceCount: number, clearColor: [number, number, number, number] = [0, 0, 0, 0]): void {
		const gl = this.gl;
		this.flushAtlasDirty();

		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.disable(gl.DEPTH_TEST);
		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
		gl.clear(gl.COLOR_BUFFER_BIT);

		if (instanceCount === 0) return;

		gl.useProgram(this.program);
		gl.uniform2f(this.uViewportLoc, this.viewportCssWidth, this.viewportCssHeight);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.uniform1i(this.uAtlasLoc, 0);

		gl.bindVertexArray(this.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		const used = instanceCount * FLOATS_PER_INSTANCE;
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceCpu.subarray(0, used));

		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);

		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	/** Make sure the per-instance CPU buffer has room for `count` glyphs. */
	ensureCapacity(count: number): Float32Array {
		if (count <= this.instanceCapacity) return this.instanceCpu;
		let cap = this.instanceCapacity;
		while (cap < count) cap *= 2;
		this.instanceCapacity = cap;
		this.instanceCpu = new Float32Array(cap * FLOATS_PER_INSTANCE);
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.instanceCpu.byteLength, gl.DYNAMIC_DRAW);
		// Re-binding attributes isn't needed (VAO captures them), but we do
		// need to point the existing layout at the recreated buffer storage.
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		return this.instanceCpu;
	}

	getInstanceCpu(): Float32Array {
		return this.instanceCpu;
	}

	get isContextLost(): boolean {
		return this.gl.isContextLost();
	}

	private bindInstanceAttribs(): void {
		const gl = this.gl;
		const program = this.program;
		const stride = FLOATS_PER_INSTANCE * 4;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

		const enable = (name: string, size: number, byteOffset: number) => {
			const loc = gl.getAttribLocation(program, name);
			if (loc < 0) return;
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, byteOffset);
			gl.vertexAttribDivisor(loc, 1);
		};

		let off = 0;
		enable('aPosSize', 4, off);
		off += 4 * 4;
		enable('aUvLo', 4, off);
		off += 4 * 4;
		enable('aUvHi', 4, off);
		off += 4 * 4;
		enable('aBlendT', 1, off);
		off += 1 * 4;
		enable('aColor', 4, off);
	}

	private flushAtlasDirty(): void {
		const dirty = this.atlas.takeDirtyRegions();
		if (dirty.length === 0) return;
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		const stride = this.atlas.textureSize;
		const isFullUpload =
			dirty.length === 1 &&
			dirty[0].x === 0 &&
			dirty[0].y === 0 &&
			dirty[0].width === stride &&
			dirty[0].height === stride;
		if (isFullUpload) {
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				stride,
				stride,
				gl.RED,
				gl.UNSIGNED_BYTE,
				this.atlas.pixels,
			);
		} else {
			// Per-region sub-uploads. We pre-extract each region's bytes into a
			// contiguous buffer because UNPACK_ROW_LENGTH on WebGL2 + R8 has
			// rough edges on iOS Safari — staging is reliable and tiny glyphs
			// only cost a few hundred bytes per copy.
			for (const r of dirty) {
				if (r.width <= 0 || r.height <= 0) continue;
				const slice = new Uint8Array(r.width * r.height);
				for (let row = 0; row < r.height; row++) {
					const srcOff = (r.y + row) * stride + r.x;
					slice.set(this.atlas.pixels.subarray(srcOff, srcOff + r.width), row * r.width);
				}
				gl.texSubImage2D(
					gl.TEXTURE_2D,
					0,
					r.x,
					r.y,
					r.width,
					r.height,
					gl.RED,
					gl.UNSIGNED_BYTE,
					slice,
				);
			}
		}
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	private rebuildAfterContextLoss(): void {
		const gl = this.gl;
		this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);
		this.uViewportLoc = gl.getUniformLocation(this.program, 'uViewport');
		this.uAtlasLoc = gl.getUniformLocation(this.program, 'uAtlas');
		this.texture = createAtlasTexture(gl, this.atlas.textureSize);
		const vao = gl.createVertexArray();
		if (!vao) throw new Error('Failed to allocate VAO');
		this.vao = vao;
		gl.bindVertexArray(vao);
		this.quadBuffer = createQuadBuffer(gl);
		const aQuadCornerLoc = gl.getAttribLocation(this.program, 'aQuadCorner');
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.enableVertexAttribArray(aQuadCornerLoc);
		gl.vertexAttribPointer(aQuadCornerLoc, 2, gl.FLOAT, false, 0, 0);
		const ib = gl.createBuffer();
		if (!ib) throw new Error('Failed to allocate instance buffer');
		this.instanceBuffer = ib;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.instanceCpu.byteLength, gl.DYNAMIC_DRAW);
		this.bindInstanceAttribs();
		gl.bindVertexArray(null);
		this.atlas.markFullyDirty();
	}
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Failed to create shader');
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile failed: ${log}\n${src}`);
	}
	return shader;
}

function compileProgram(
	gl: WebGL2RenderingContext,
	vertSrc: string,
	fragSrc: string,
): WebGLProgram {
	const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
	const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
	const program = gl.createProgram();
	if (!program) throw new Error('Failed to create program');
	gl.attachShader(program, vert);
	gl.attachShader(program, frag);
	gl.linkProgram(program);
	gl.deleteShader(vert);
	gl.deleteShader(frag);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Program link failed: ${log}`);
	}
	return program;
}

function createAtlasTexture(gl: WebGL2RenderingContext, size: number): WebGLTexture {
	const tex = gl.createTexture();
	if (!tex) throw new Error('Failed to create atlas texture');
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return tex;
}

function createQuadBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
	const buf = gl.createBuffer();
	if (!buf) throw new Error('Failed to create quad buffer');
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	// Triangle strip corners: (0,0), (1,0), (0,1), (1,1)
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	return buf;
}
