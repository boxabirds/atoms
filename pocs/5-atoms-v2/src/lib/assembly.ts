import type { AtomInstance } from './types';

// ---------------------------------------------------------------------------
// Assembly analysis: detect structural spine, limbs, and semantic roles
// This is the foundation of the procedural animation pipeline from the brief
// (Spore-like spine/limb detection → gait → IK)
// ---------------------------------------------------------------------------

export interface AssemblyAnalysis {
  /** All atom IDs in this connected component */
  atomIds: number[];
  /** Spine: longest chain of Shell atoms (structural backbone) */
  spineIds: number[];
  /** Limbs: branches off the spine that end near ground or with Push atoms */
  limbs: LimbInfo[];
  /** Sense atoms (potential "head/eye" candidates) */
  senseIds: number[];
  /** Push atoms (potential locomotion sources) */
  pushIds: number[];
}

export interface LimbInfo {
  atomIds: number[];
  /** Whether this limb terminates with a Push (locomotion) */
  hasPush: boolean;
  /** Whether this limb terminates near the ground */
  isGrounded: boolean;
  /** Attachment point on spine (spine atom ID) */
  spineAttachId: number;
}

// ---------------------------------------------------------------------------
// Connected components: find all atoms reachable from a given atom
// ---------------------------------------------------------------------------

function findConnectedComponent(startId: number, atoms: AtomInstance[]): number[] {
  const visited = new Set<number>();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const atom = atoms.find((a) => a.id === id);
    if (atom) {
      for (const connId of atom.connections) {
        if (!visited.has(connId)) queue.push(connId);
      }
    }
  }
  return Array.from(visited);
}

// ---------------------------------------------------------------------------
// Spine detection: longest path through Shell atoms using BFS
// ---------------------------------------------------------------------------

function findSpine(componentIds: number[], atoms: AtomInstance[]): number[] {
  const shellIds = componentIds.filter((id) => {
    const a = atoms.find((at) => at.id === id);
    return a?.kind === 'shell';
  });

  if (shellIds.length === 0) return [];
  if (shellIds.length === 1) return shellIds;

  // BFS from each shell endpoint to find the longest path (diameter of shell subgraph)
  let longestPath: number[] = [];

  // Find a far endpoint from an arbitrary start
  const start = shellIds[0];
  const farEnd = bfsFarthest(start, shellIds, atoms);
  // Find the actual longest path from that far endpoint
  const otherEnd = bfsFarthest(farEnd, shellIds, atoms);
  longestPath = bfsPath(farEnd, otherEnd, shellIds, atoms);

  return longestPath;
}

function bfsFarthest(startId: number, validIds: number[], atoms: AtomInstance[]): number {
  const validSet = new Set(validIds);
  const visited = new Set<number>();
  const queue: number[] = [startId];
  visited.add(startId);
  let farthest = startId;

  while (queue.length > 0) {
    const id = queue.shift()!;
    farthest = id;
    const atom = atoms.find((a) => a.id === id);
    if (!atom) continue;
    for (const connId of atom.connections) {
      if (!visited.has(connId) && validSet.has(connId)) {
        visited.add(connId);
        queue.push(connId);
      }
    }
  }
  return farthest;
}

function bfsPath(fromId: number, toId: number, validIds: number[], atoms: AtomInstance[]): number[] {
  const validSet = new Set(validIds);
  const visited = new Map<number, number | null>(); // id → parent
  const queue: number[] = [fromId];
  visited.set(fromId, null);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === toId) break;
    const atom = atoms.find((a) => a.id === id);
    if (!atom) continue;
    for (const connId of atom.connections) {
      if (!visited.has(connId) && validSet.has(connId)) {
        visited.set(connId, id);
        queue.push(connId);
      }
    }
  }

  // Reconstruct path
  const path: number[] = [];
  let current: number | null = toId;
  while (current !== null) {
    path.unshift(current);
    current = visited.get(current) ?? null;
    if (current === null && path[0] !== fromId) break; // disconnected
  }
  return path;
}

// ---------------------------------------------------------------------------
// Limb detection: branches off spine
// ---------------------------------------------------------------------------

function findLimbs(spineIds: number[], componentIds: number[], atoms: AtomInstance[]): LimbInfo[] {
  const spineSet = new Set(spineIds);
  const limbs: LimbInfo[] = [];
  const GROUND_THRESHOLD = 1.0;

  for (const spineId of spineIds) {
    const spineAtom = atoms.find((a) => a.id === spineId);
    if (!spineAtom) continue;

    for (const connId of spineAtom.connections) {
      if (spineSet.has(connId)) continue; // Skip spine-to-spine connections

      // Trace this branch
      const limbIds: number[] = [];
      const visited = new Set<number>(spineIds);
      const queue = [connId];
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        limbIds.push(id);
        const a = atoms.find((at) => at.id === id);
        if (a) {
          for (const c of a.connections) {
            if (!visited.has(c)) queue.push(c);
          }
        }
      }

      if (limbIds.length === 0) continue;

      // Check if limb has Push (locomotion)
      const hasPush = limbIds.some((id) => atoms.find((a) => a.id === id)?.kind === 'push');

      // Check if limb endpoint is near ground
      const endAtom = atoms.find((a) => a.id === limbIds[limbIds.length - 1]);
      const isGrounded = endAtom ? endAtom.body.translation().y < GROUND_THRESHOLD : false;

      limbs.push({
        atomIds: limbIds,
        hasPush,
        isGrounded,
        spineAttachId: spineId,
      });
    }
  }

  return limbs;
}

// ---------------------------------------------------------------------------
// Full assembly analysis
// ---------------------------------------------------------------------------

export function analyzeAssembly(startAtomId: number, atoms: AtomInstance[]): AssemblyAnalysis {
  const componentIds = findConnectedComponent(startAtomId, atoms);
  const spineIds = findSpine(componentIds, atoms);
  const limbs = findLimbs(spineIds, componentIds, atoms);
  const senseIds = componentIds.filter((id) => atoms.find((a) => a.id === id)?.kind === 'sense');
  const pushIds = componentIds.filter((id) => atoms.find((a) => a.id === id)?.kind === 'push');

  return { atomIds: componentIds, spineIds, limbs, senseIds, pushIds };
}
