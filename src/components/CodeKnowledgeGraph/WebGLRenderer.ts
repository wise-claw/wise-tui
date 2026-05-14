import type { GraphNode, GraphEdge } from "../../types/codeKnowledgeGraph";

export interface WebGLRendererOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  onNodeHover?: (node: GraphNode | null) => void;
  onNodeClick?: (node: GraphNode) => void;
}

const NODE_COLORS: Record<string, [number, number, number]> = {
  repo: [0.094, 0.565, 1.0],
  folder: [0.322, 0.769, 0.102],
  file: [0.98, 0.678, 0.078],
  symbol: [0.922, 0.184, 0.588],
};

const DEFAULT_COLOR: [number, number, number] = [0.6, 0.6, 0.6];

const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  attribute vec4 a_color;
  uniform vec2 u_resolution;
  uniform vec2 u_translate;
  uniform float u_scale;
  varying vec4 v_color;
  void main() {
    vec2 clip = ((a_position + u_translate) * u_scale) / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_color = a_color;
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  varying vec4 v_color;
  void main() {
    gl_FragColor = v_color;
  }
`;

const NODE_VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec4 a_color;
  attribute float a_radius;
  uniform vec2 u_resolution;
  uniform vec2 u_translate;
  uniform float u_scale;
  varying vec4 v_color;
  varying vec2 v_center;
  varying float v_radius;
  void main() {
    vec2 clip = ((a_position + u_translate) * u_scale) / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = a_radius * u_scale * 2.0;
    v_color = a_color;
    v_radius = a_radius * u_scale;
  }
`;

const NODE_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec4 v_color;
  void main() {
    vec2 coord = gl_PointCoord - 0.5;
    if (length(coord) > 0.5) discard;
    gl_FragColor = v_color;
  }
`;

interface ProgramInfo {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export class WebGLRenderer {
  private gl: WebGLRenderingContext;
  private edgeProgram: ProgramInfo;
  private nodeProgram: ProgramInfo;
  private edgeBuffer: WebGLBuffer | null = null;
  private nodePosBuffer: WebGLBuffer | null = null;
  private nodeColorBuffer: WebGLBuffer | null = null;
  private nodeRadiusBuffer: WebGLBuffer | null = null;
  private width = 800;
  private height = 600;
  private translate = { x: 0, y: 0 };
  private scale = 1.0;
  private hoveredNode: GraphNode | null = null;
  private nodePositions: Map<string, { x: number; y: number; node: GraphNode; radius: number }> = new Map();
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };

  constructor(options: WebGLRendererOptions) {
    const gl = options.canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    this.edgeProgram = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    this.nodeProgram = this.createProgram(NODE_VERTEX_SHADER, NODE_FRAGMENT_SHADER);

    this.resize(options.width, options.height);
    this.setupEvents(options);
  }

  private createProgram(vsSource: string, fsSource: string): ProgramInfo {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(vs) ?? "vertex shader compile");
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(fs) ?? "fragment shader compile");
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "program link");
    }

    const attribs: Record<string, number> = {};
    const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < numAttribs; i++) {
      const info = gl.getActiveAttrib(program, i)!;
      attribs[info.name] = gl.getAttribLocation(program, info.name);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i)!;
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }

    return { program, attribs, uniforms };
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.gl.canvas.width = width * dpr;
    this.gl.canvas.height = height * dpr;
    this.gl.viewport(0, 0, width * dpr, height * dpr);
  }

  render(
    nodes: GraphNode[],
    edges: GraphEdge[],
    positions: Map<string, { x: number; y: number }>,
    zoomLevel?: "low" | "medium" | "high",
  ) {
    const gl = this.gl;
    gl.clearColor(0.08, 0.08, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.nodePositions.clear();
    const baseRadius = 6;

    // LOD: determine which nodes to show
    const lod = zoomLevel ?? "medium";
    const visibleNodes = nodes.filter((n) => {
      if (lod === "high") return true;
      if (lod === "medium") return n.kind !== "symbol";
      return n.kind === "repo" || n.kind === "folder";
    });
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = edges.filter(
      (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
    );

    // Render edges
    const edgeData = new Float32Array(visibleEdges.length * 4);
    for (let i = 0; i < visibleEdges.length; i++) {
      const edge = visibleEdges[i];
      const src = positions.get(edge.source);
      const tgt = positions.get(edge.target);
      if (src && tgt) {
        edgeData[i * 4 + 0] = src.x;
        edgeData[i * 4 + 1] = src.y;
        edgeData[i * 4 + 2] = tgt.x;
        edgeData[i * 4 + 3] = tgt.y;
      }
    }

    gl.useProgram(this.edgeProgram.program);
    gl.uniform2f(this.edgeProgram.uniforms.u_resolution, this.width, this.height);
    gl.uniform2f(this.edgeProgram.uniforms.u_translate, this.translate.x, this.translate.y);
    gl.uniform1f(this.edgeProgram.uniforms.u_scale, this.scale);

    if (!this.edgeBuffer) this.edgeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edgeData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.edgeProgram.attribs.a_position);
    gl.vertexAttribPointer(this.edgeProgram.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

    // Edge color as attribute
    const edgeColorData = new Float32Array(visibleEdges.length * 8);
    for (let i = 0; i < visibleEdges.length; i++) {
      edgeColorData[i * 8 + 0] = 0.5;
      edgeColorData[i * 8 + 1] = 0.5;
      edgeColorData[i * 8 + 2] = 0.5;
      edgeColorData[i * 8 + 3] = 0.3;
      edgeColorData[i * 8 + 4] = 0.5;
      edgeColorData[i * 8 + 5] = 0.5;
      edgeColorData[i * 8 + 6] = 0.5;
      edgeColorData[i * 8 + 7] = 0.3;
    }
    const edgeColorBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, edgeColorData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.edgeProgram.attribs.a_color);
    gl.vertexAttribPointer(this.edgeProgram.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINES, 0, visibleEdges.length * 2);
    gl.deleteBuffer(edgeColorBuf);

    // Render nodes
    const posData = new Float32Array(visibleNodes.length * 2);
    const colorData = new Float32Array(visibleNodes.length * 4);
    const radiusData = new Float32Array(visibleNodes.length);

    for (let i = 0; i < visibleNodes.length; i++) {
      const n = visibleNodes[i];
      const pos = positions.get(n.id);
      if (!pos) continue;
      posData[i * 2 + 0] = pos.x;
      posData[i * 2 + 1] = pos.y;

      const color = NODE_COLORS[n.kind] ?? DEFAULT_COLOR;
      const isHovered = this.hoveredNode?.id === n.id;
      colorData[i * 4 + 0] = color[0];
      colorData[i * 4 + 1] = color[1];
      colorData[i * 4 + 2] = color[2];
      colorData[i * 4 + 3] = isHovered ? 1.0 : 0.9;

      const radius = n.kind === "repo" ? baseRadius * 2 : n.kind === "folder" ? baseRadius * 1.5 : baseRadius;
      radiusData[i] = isHovered ? radius + 3 : radius;

      this.nodePositions.set(n.id, { x: pos.x, y: pos.y, node: n, radius });
    }

    gl.useProgram(this.nodeProgram.program);
    gl.uniform2f(this.nodeProgram.uniforms.u_resolution, this.width, this.height);
    gl.uniform2f(this.nodeProgram.uniforms.u_translate, this.translate.x, this.translate.y);
    gl.uniform1f(this.nodeProgram.uniforms.u_scale, this.scale);

    if (!this.nodePosBuffer) this.nodePosBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodeProgram.attribs.a_position);
    gl.vertexAttribPointer(this.nodeProgram.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

    if (!this.nodeColorBuffer) this.nodeColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodeProgram.attribs.a_color);
    gl.vertexAttribPointer(this.nodeProgram.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

    if (!this.nodeRadiusBuffer) this.nodeRadiusBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeRadiusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, radiusData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodeProgram.attribs.a_radius);
    gl.vertexAttribPointer(this.nodeProgram.attribs.a_radius, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, visibleNodes.length);
  }

  getTransform() {
    return { ...this.translate, scale: this.scale };
  }

  setTransform(t: { x: number; y: number; scale: number }) {
    this.translate = { x: t.x, y: t.y };
    this.scale = t.scale;
  }

  getZoomLevel(): "low" | "medium" | "high" {
    if (this.scale < 0.5) return "low";
    if (this.scale < 1.5) return "medium";
    return "high";
  }

  screenToGraph(sx: number, sy: number) {
    return {
      x: (sx - this.translate.x) / this.scale,
      y: (sy - this.translate.y) / this.scale,
    };
  }

  findNodeAt(gx: number, gy: number, radius = 12): GraphNode | null {
    for (const [, entry] of this.nodePositions) {
      const dx = gx - entry.x;
      const dy = gy - entry.y;
      if (dx * dx + dy * dy < radius * radius) return entry.node;
    }
    return null;
  }

  private setupEvents(options: WebGLRendererOptions) {
    const canvas = options.canvas;

    canvas.addEventListener("mousedown", (e: MouseEvent) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.translate.x, y: e.clientY - this.translate.y };
    });

    canvas.addEventListener("mousemove", (e: MouseEvent) => {
      if (this.isDragging) {
        this.translate = {
          x: e.clientX - this.dragStart.x,
          y: e.clientY - this.dragStart.y,
        };
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const pos = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
      const node = this.findNodeAt(pos.x, pos.y);
      this.hoveredNode = node;
      options.onNodeHover?.(node);
      canvas.style.cursor = node ? "pointer" : "grab";
    });

    canvas.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    canvas.addEventListener("mouseleave", () => {
      this.isDragging = false;
      this.hoveredNode = null;
      options.onNodeHover?.(null);
    });

    canvas.addEventListener("click", (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
      const node = this.findNodeAt(pos.x, pos.y);
      if (node) options.onNodeClick?.(node);
    });

    canvas.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      this.scale = Math.min(5, Math.max(0.1, this.scale * (1 + delta)));
    }, { passive: false });
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.edgeProgram.program);
    gl.deleteProgram(this.nodeProgram.program);
    if (this.edgeBuffer) gl.deleteBuffer(this.edgeBuffer);
    if (this.nodePosBuffer) gl.deleteBuffer(this.nodePosBuffer);
    if (this.nodeColorBuffer) gl.deleteBuffer(this.nodeColorBuffer);
    if (this.nodeRadiusBuffer) gl.deleteBuffer(this.nodeRadiusBuffer);
  }
}
