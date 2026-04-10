import { describe, it, expect } from "vitest";
import { ToastContext } from "./useToast";
import type { Toast } from "./useToast";

describe("ToastContext", () => {
  it("has default with empty toasts and no-op functions", () => {
    const def = (ToastContext as any)._currentValue;
    expect(def.toasts).toEqual([]);
    expect(typeof def.addToast).toBe("function");
    expect(typeof def.removeToast).toBe("function");
    expect(() => def.addToast("test")).not.toThrow();
    expect(() => def.removeToast(1)).not.toThrow();
  });
});

describe("Toast type", () => {
  it("satisfies shape", () => {
    const t: Toast = { id: 1, message: "err", type: "error" };
    expect(t.type).toBe("error");
    const t2: Toast = { id: 2, message: "info", type: "info" };
    expect(t2.type).toBe("info");
  });
});
