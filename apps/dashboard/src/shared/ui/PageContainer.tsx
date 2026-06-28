// 라우트 공통 컨테이너 — 폭 variant(default 1240 / narrow 900).
import { type ReactNode } from "react";

interface PageContainerProps {
  width?: "default" | "narrow";
  children: ReactNode;
}

const WIDTH: Record<NonNullable<PageContainerProps["width"]>, string> = {
  default: "max-w-[1240px]",
  narrow: "max-w-[900px]",
};

export function PageContainer({ width = "default", children }: PageContainerProps) {
  return (
    <div className={`mx-auto w-full ${WIDTH[width]} px-6 py-12`}>{children}</div>
  );
}
