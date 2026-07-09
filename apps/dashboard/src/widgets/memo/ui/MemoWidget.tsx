import { MemoComposer } from "@/features/memo-compose/ui/MemoComposer";
import { MemoList } from "@/features/memo-manage/ui/MemoList";
import type { Memo, MemoTransformation } from "@/entities/memo/client";
import type { TransformPresetOption } from "@/features/memo-transform/client";

interface MemoWidgetProps {
  memos: Memo[];
  transformationsByMemo: Record<string, MemoTransformation[]>;
  presets: TransformPresetOption[];
}

// /memos 페이지용 조합 위젯 — composer(client) + list(client)를 서버 컴포넌트로 감싼다.
export function MemoWidget({ memos, transformationsByMemo, presets }: MemoWidgetProps) {
  return (
    <div className="space-y-6">
      <MemoComposer />
      <MemoList memos={memos} transformationsByMemo={transformationsByMemo} presets={presets} />
    </div>
  );
}
