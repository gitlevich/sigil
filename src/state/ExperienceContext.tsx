/**
 * ExperienceContext — shares the live experience stream and recording functions.
 *
 * Provides a getter (no re-renders) and a recordChat function for
 * conversation events to enter the experience stream.
 */
import { createContext, useContext, ReactNode } from "react";
import type { ExperienceSegment } from "sigil-core/rightHemisphere";
import type { MemoryState } from "sigil-core/memory";

interface ExperienceHandle {
  getExperience: () => ExperienceSegment[];
  recordChat: (role: "user" | "assistant", content: string) => void;
  getMemory: () => MemoryState;
}

const ExperienceContext = createContext<ExperienceHandle>({
  getExperience: () => [],
  recordChat: () => {},
  getMemory: () => ({ sigils: new Map() }),
});

export function ExperienceProvider({ handle, children }: { handle: ExperienceHandle; children: ReactNode }) {
  return (
    <ExperienceContext.Provider value={handle}>
      {children}
    </ExperienceContext.Provider>
  );
}

export function useExperience(): ExperienceHandle {
  return useContext(ExperienceContext);
}
