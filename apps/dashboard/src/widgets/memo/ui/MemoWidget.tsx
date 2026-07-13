import { MemoComposer } from "@/features/memo-compose/ui/MemoComposer";
import { SearchableMemoList } from "@/features/memo-search/ui/SearchableMemoList";
import type { Memo, MemoActionItem, MemoTransformation } from "@/entities/memo/client";
import type { TransformPresetOption } from "@/features/memo-transform/client";

interface MemoWidgetProps {
  memos: Memo[];
  transformationsByMemo: Record<string, MemoTransformation[]>;
  presets: TransformPresetOption[];
  actionItemsByMemo?: Record<string, MemoActionItem[]>;
  /** 등록된 카테고리 목록 — 필터 칩·배지 조회 (DB memo_categories, 서버 로드). */
  categories: { id: string; labelKo: string }[];
}

// /memos 페이지용 조합 위젯 — composer(client) + 검색바·목록(client)을 서버 컴포넌트로 감싼다.
export function MemoWidget({
  memos,
  transformationsByMemo,
  presets,
  actionItemsByMemo,
  categories,
}: MemoWidgetProps) {
  return (
    <div className="space-y-6">
      <MemoComposer />
      <SearchableMemoList
        memos={memos}
        transformationsByMemo={transformationsByMemo}
        presets={presets}
        actionItemsByMemo={actionItemsByMemo}
        categories={categories}
      />
    </div>
  );
}
