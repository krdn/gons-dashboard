// 깊은 경로 import 강제: barrel 에 넣지 말 것 (Gotcha #1).
//
// Pure presentational. PlayMCP suggested_narrative_ko 를 받아 6/5/4 문단으로
// split 후 첫 줄([프로필] 메타) 제거 + 단락별 <p> 렌더.

interface TigerNarrativeProps {
  narrative: string;
  emphasizeFirstParagraph?: boolean;
}

export function TigerNarrative({ narrative, emphasizeFirstParagraph }: TigerNarrativeProps) {
  const paragraphs = narrative
    .split("\n\n")
    .filter((p) => p.trim() !== "" && !p.startsWith("[프로필]"));
  return (
    <div className="space-y-3 text-gray-800">
      {paragraphs.map((p, idx) => (
        <p key={idx} className={emphasizeFirstParagraph && idx === 0 ? "font-medium text-gray-900" : ""}>
          {p}
        </p>
      ))}
    </div>
  );
}
