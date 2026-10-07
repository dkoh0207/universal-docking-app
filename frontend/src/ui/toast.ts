import { toast as sonner } from "sonner";

export function toast(message: string, kind: "ok" | "err" = "ok") {
  if (kind === "err") sonner.error(message, { duration: 5000 });
  else sonner.success(message, { duration: 2600 });
}
