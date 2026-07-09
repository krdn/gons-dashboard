import { MemoComposer } from "@/features/memo-compose/ui/MemoComposer";
import { MemoList } from "@/features/memo-manage/ui/MemoList";
import type { Memo } from "@/entities/memo/client";

interface MemoWidgetProps {
  memos: Memo[];
}

// /memos 페이지용 조합 위젯 — composer(client) + list(client)를 서버 컴포넌트로 감싼다.
export function MemoWidget({ memos }: MemoWidgetProps) {
  return (
    <div className="space-y-6">
      <MemoComposer />
      <MemoList memos={memos} />
    </div>
  );
}
