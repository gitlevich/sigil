import { createContext, useContext } from "react";

export interface Toast {
  id: number;
  message: string;
  type: "error" | "info";
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: "error" | "info") => void;
  removeToast: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}
