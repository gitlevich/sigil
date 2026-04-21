/**
 * Subscribe to #increase-resolution lifecycle events and drive the visible
 * attempt state the @user perceives as a small glow.
 *
 * Three visible states: rest / unserved / in-flight. See
 * `AppContext.ResolutionIncreaseState` for the phenomenology.
 */
import { useEffect, useRef } from "react";
import { events, fallbackProvider } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";

const UNSERVED_FADE_MS = 600;

function tierOf(providerKind: string): "local" | "remote" {
  return providerKind === "anthropic" || providerKind === "openai" ? "remote" : "local";
}

export function useResolutionIncrease() {
  const dispatch = useAppDispatch();
  const app = useAppState();
  const settingsRef = useRef(app.settings);
  settingsRef.current = app.settings;

  useEffect(() => {
    const unlistenBegin = events.onResolutionIncreaseBegin(({ hasFallback }) => {
      if (!hasFallback) {
        dispatch({ type: "SET_RESOLUTION_INCREASE", value: { kind: "unserved" } });
        window.setTimeout(() => {
          dispatch({ type: "SET_RESOLUTION_INCREASE", value: { kind: "rest" } });
        }, UNSERVED_FADE_MS);
        return;
      }
      // Tier of the escalated attention is read from the configured fallback.
      // Backend cascade will eventually emit tier directly; for now the
      // frontend derives it from settings.
      const fallback = fallbackProvider(settingsRef.current);
      const tier = fallback ? tierOf(fallback.provider) : "local";
      dispatch({
        type: "SET_RESOLUTION_INCREASE",
        value: {
          kind: "in-flight",
          tier,
          provider: fallback?.provider,
          label: fallback ? `${fallback.provider} · ${fallback.model}` : undefined,
        },
      });
    });

    const unlistenEnd = events.onResolutionIncreaseEnd(() => {
      dispatch({ type: "SET_RESOLUTION_INCREASE", value: { kind: "rest" } });
    });

    return () => {
      unlistenBegin.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [dispatch]);
}
