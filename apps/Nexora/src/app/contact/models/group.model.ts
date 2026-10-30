import { squareJpeg } from "@/app/profile/utils/profile.utils";

export type Image = Awaited<ReturnType<typeof squareJpeg>>;
