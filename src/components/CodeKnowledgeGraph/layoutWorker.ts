/**
 * Force-directed layout computation.
 * Run as a Web Worker or inline via Blob URL.
 *
 * Input message: { nodes: { id: string }[], edges: { source: string, target: string }[], width: number, height: number }
 * Output message: { positions: { id: string, x: number, y: number }[] }
 */

interface WorkerNode { id: string }
interface WorkerEdge { source: string; target: string }

const ITERATIONS = 300;
const REPULSION = 5000;
const ATTRACTION = 0.01;
const DAMPING = 0.85;
const GRAVITY = 0.01;

self.onmessage = function (e: MessageEvent) {
  const {
    nodes,
    edges,
    width,
    height,
  }: { nodes: WorkerNode[]; edges: WorkerEdge[]; width: number; height: number } = e.data;

  const cx = width / 2;
  const cy = height / 2;

  // Initialize positions
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const nodeIds = nodes.map((n) => n.id);
  const idSet = new Set(nodeIds);

  // Repo at center, others in circle
  const others = nodeIds.filter((id) => !id.includes(":repo:"));
  const repos = nodeIds.filter((id) => id.includes(":repo:"));

  for (const id of repos) {
    pos.set(id, { x: cx, y: cy, vx: 0, vy: 0 });
  }

  const radius = Math.min(width, height) * 0.35;
  for (let i = 0; i < others.length; i++) {
    const angle = (2 * Math.PI * i) / Math.max(others.length, 1);
    pos.set(others[i], {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  }

  // Build adjacency for attraction
  const validEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));

  // Run force simulation
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const temperature = 1.0 - iter / ITERATIONS;
    const maxMove = 10 * temperature + 1;

    // Repulsion between all pairs
    for (let i = 0; i < nodeIds.length; i++) {
      const a = pos.get(nodeIds[i])!;
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = pos.get(nodeIds[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1;
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attraction along edges
    for (const edge of validEdges) {
      const a = pos.get(edge.source);
      const b = pos.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.1) continue;
      const force = dist * ATTRACTION;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Gravity toward center
    for (const id of nodeIds) {
      const p = pos.get(id)!;
      p.vx += (cx - p.x) * GRAVITY;
      p.vy += (cy - p.y) * GRAVITY;
    }

    // Apply velocity with damping and clamp
    for (const id of nodeIds) {
      const p = pos.get(id)!;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      const move = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (move > maxMove) {
        p.vx = (p.vx / move) * maxMove;
        p.vy = (p.vy / move) * maxMove;
      }
      p.x += p.vx;
      p.y += p.vy;
      // Keep in bounds
      p.x = Math.max(20, Math.min(width - 20, p.x));
      p.y = Math.max(20, Math.min(height - 20, p.y));
    }
  }

  const positions = nodeIds.map((id) => {
    const p = pos.get(id)!;
    return { id, x: p.x, y: p.y };
  });

  self.postMessage({ positions });
};

export {};
