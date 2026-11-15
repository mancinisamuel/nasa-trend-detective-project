import type { ReactNode } from "react";

export type StatusTone = "info" | "warning" | "error";

type StatusBannerProps = {
  tone: StatusTone;
  children: ReactNode;
};

// UI primitive: no data logic. Errors are announced assertively, everything else politely (aria-live).
export function StatusBanner({ tone, children }: StatusBannerProps) {
  const role = tone === "error" ? "alert" : "status";
  return (
    <div role={role} className={`td-status td-status--${tone}`}>
      {children}
    </div>
  );
}
