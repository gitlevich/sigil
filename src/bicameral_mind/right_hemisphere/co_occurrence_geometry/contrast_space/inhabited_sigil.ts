/**
 * InhabitedSigil — the Position currently attended to by the user.
 *
 * Spec: BicameralMind/RightHemisphere/CoOccurrenceGeometry/ContrastSpace/InhabitedSigil
 * Invariant: singular — there is exactly one InhabitedSigil at any time.
 */

import type { Position } from "./position";

export interface InhabitedSigil {
  position: Position;
}
