// catalog-refresh feature — client-safe entrypoint.
// "use server" 파일 전체가 RPC 경계라, 여기서 server-only spawnSnapshot 을
// import 해도 client bundle 그래프로 끌려오지 않는다 (Gotcha #7 패턴).
// "use client" 컴포넌트는 이 entrypoint 로만 refreshCatalog 를 호출한다.
"use server";

import { revalidatePath } from "next/cache";

import type { CatalogKind, RefreshResult } from "./model/types";
import { spawnSnapshot } from "./index";

export type { CatalogKind, RefreshResult } from "./model/types";

/** 버튼 클릭 시 호출되는 Server Action. 재생성 후 해당 페이지 revalidate. */
export async function refreshCatalog(kind: CatalogKind): Promise<RefreshResult> {
  const result = await spawnSnapshot(kind);
  if (result.ok) {
    revalidatePath(`/${kind}`);
  }
  return result;
}
