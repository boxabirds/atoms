export const MAP_TYPES = [
  'displacement',
  'albedo',
  'roughness',
  'metalness',
  'emissive',
] as const;

export type MapType = (typeof MAP_TYPES)[number];

/** All possible map keys including the client-derived normal map */
export type MapKey = MapType | 'normal';

export interface MaterialScalars {
  roughness: number;
  metalness: number;
  transmission: number;
  thickness: number;
  ior: number;
  displacementScale: number;
  emissiveIntensity: number;
  emissiveColor: string | null;
  /** Base color hex (e.g. "#FFD700") used when albedo is uniform / no albedo map */
  baseColor: string | null;
}

export interface MaterialRecipe {
  mapsToGenerate: MapType[];
  mapDescriptions: Partial<Record<MapType, string>>;
  scalars: MaterialScalars;
}

export interface HistoryEntry {
  id: string;
  prompt: string;
  recipe: MaterialRecipe;
  maps: Partial<Record<MapKey, string>>; // data URLs, filled progressively
  timestamp: number;
}

/** Default scalars for a neutral material (no maps, no effects) */
export const DEFAULT_SCALARS: MaterialScalars = {
  roughness: 0.5,
  metalness: 0.0,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  displacementScale: 0.15,
  emissiveIntensity: 0,
  emissiveColor: null,
  baseColor: null,
};
