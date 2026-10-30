import type { ReactNode } from "react";

// a yes/no question before a change that can't be taken back
export type Ask = { title: string; message: ReactNode; ok: string; run: () => Promise<unknown> };
