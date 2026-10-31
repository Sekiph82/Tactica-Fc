// Kroge mellem moduler, der ellers ville importere hinanden i ring (ingen imports her).
import type { Competition } from './types';

/** Draft-ligaen registrerer, hvad der sker, når ligaen er færdig */
export const compHooks: { draftLeagueDone?: (comp: Competition) => void } = {};
