// Map registry. Every map is pure data with the same shape; sim, renderer,
// and server all read from here.

import { DEPOT } from './depot.js';
import { COMPOUND } from './compound.js';
import { PIPELINE } from './pipeline.js';

export const MAPS = { depot: DEPOT, compound: COMPOUND, pipeline: PIPELINE };
export const MAP_LIST = [DEPOT, COMPOUND, PIPELINE];
export const DEFAULT_MAP = 'depot';
