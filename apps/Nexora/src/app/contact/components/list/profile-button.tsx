import type { ReactNode } from "react";

export function ProfileButton({ userId, onProfile, children }: { userId: string; onProfile: (userId: string) => void; children: ReactNode }) {
  return (
    <button className="relative" title="Xem hồ sơ" onClick={() => onProfile(userId)}>
      {children}
    </button>
  );
}
