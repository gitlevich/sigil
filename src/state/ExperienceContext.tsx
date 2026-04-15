/**
 * ExperienceContext — shares the live experience stream from the RightHemisphere.
 *
 * Provides a getter function (not state) so reading experience doesn't trigger
 * re-renders. The overlay polls on an interval when open.
 */
import { createContext, useContext, ReactNode } from "react";
import type { ExperienceSegment } from "sigil-core/rightHemisphere";

type ExperienceGetter = () => ExperienceSegment[];

const ExperienceContext = createContext<ExperienceGetter>(() => []);

export function ExperienceProvider({ getExperience, children }: { getExperience: ExperienceGetter; children: ReactNode }) {
  return (
    <ExperienceContext.Provider value={getExperience}>
      {children}
    </ExperienceContext.Provider>
  );
}

export function useExperience(): ExperienceGetter {
  return useContext(ExperienceContext);
}
