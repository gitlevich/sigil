/**
 * Subscribe to #increase-resolution lifecycle events and drive the visible
 * attempt state the @user perceives as a small glow.
 *
 * Three visible states: rest / unserved / in-flight. See
 * `AppContext.ResolutionIncreaseState` for the phenomenology.
 */
import { useEffect } from "react";
import { events } from "../tauri";
import { useAppDispatch } from "../state/AppContext";

const UNSERVED_FADE_MS = 600;

export function useResolutionIncrease() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unlistenBegin = events.onResolutionIncreaseBegin(({ hasFallback }) => {
      dispatch({
        type: "SET_RESOLUTION_INCREASE",
        value: hasFallback ? "in-flight" : "unserved",
      });
      if (!hasFallback) {
        // No higher-resolution model — show the attempt briefly and fade.
        window.setTimeout(() => {
          dispatch({ type: "SET_RESOLUTION_INCREASE", value: "rest" });
        }, UNSERVED_FADE_MS);
      }
    });

    const unlistenEnd = events.onResolutionIncreaseEnd(() => {
      dispatch({ type: "SET_RESOLUTION_INCREASE", value: "rest" });
    });

    return () => {
      unlistenBegin.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [dispatch]);
}
