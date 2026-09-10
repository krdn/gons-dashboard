"use client";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="hub-page"><section className="hub-panel hub-empty" role="alert"><h1 className="text-xl font-semibold">화면을 불러오지 못했습니다</h1><p>잠시 후 다시 시도하세요. 저장된 기록은 그대로 유지됩니다.</p><button className="hub-button primary" onClick={reset}>다시 시도</button></section></main>;
}
