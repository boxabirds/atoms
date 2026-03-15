import type { AtomInstance, AtomKind, PushParams, SenseParams, ZapParams, FlexParams } from './types';

// ---------------------------------------------------------------------------
// Energy budget: Shells are free, active atoms cost energy proportional
// to parameter intensity. Forces meaningful tradeoffs.
// ---------------------------------------------------------------------------

const MAX_ENERGY = 100;

/** Base cost per atom kind (Shells are free) */
const BASE_COST: Record<AtomKind, number> = {
  shell: 0,
  flex: 5,
  push: 10,
  sense: 8,
  zap: 12,
};

/** Calculate energy cost for a single atom based on its params */
export function atomEnergyCost(atom: AtomInstance): number {
  const base = BASE_COST[atom.kind];

  switch (atom.kind) {
    case 'push': {
      const p = atom.params as PushParams;
      return base + p.magnitude * 0.2;
    }
    case 'sense': {
      const p = atom.params as SenseParams;
      return base + p.range * 0.5;
    }
    case 'zap': {
      const p = atom.params as ZapParams;
      return base + p.intensity * 0.3 + p.range * 0.2;
    }
    case 'flex': {
      const p = atom.params as FlexParams;
      return base + p.stiffness * 0.05;
    }
    default:
      return base;
  }
}

/** Calculate total energy used by all atoms */
export function totalEnergy(atoms: AtomInstance[]): number {
  return atoms.reduce((sum, a) => sum + atomEnergyCost(a), 0);
}

/** Check if adding an atom would exceed the budget */
export function canAfford(atoms: AtomInstance[], newAtom: AtomInstance): boolean {
  return totalEnergy(atoms) + atomEnergyCost(newAtom) <= MAX_ENERGY;
}

export { MAX_ENERGY };
