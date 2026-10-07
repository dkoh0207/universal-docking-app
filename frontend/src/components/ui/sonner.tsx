import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";

import { useTheme } from "@/lib/theme";

const Toaster = (props: ToasterProps) => {
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-primary" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <CircleAlertIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "font-sans" } }}
      {...props}
    />
  );
};

export { Toaster };
