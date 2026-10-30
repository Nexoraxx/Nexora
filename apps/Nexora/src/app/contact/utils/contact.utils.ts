import { cn } from "@/shared/utils/shadcn";

// row actions show on hover, or always with `visible`
export const actions = (visible?: boolean) => cn("flex gap-1.5", !visible && "invisible group-hover/row:visible");
