export const DOCUMENT_TEMPLATES = {
  handoff: {
    label: "AI 인계",
    description: "다음 세션이 바로 이어갈 수 있는 작업 맥락",
    sections: [
      "목표와 완료 조건",
      "현재 상태 · 완료한 작업",
      "핵심 결정과 이유",
      "관련 파일 · 명령 · 참고 자료",
      "검증 결과와 미확인 사항",
      "다음 작업",
      "주의사항 · 승인 필요한 작업",
    ],
  },
  manual: {
    label: "기술 매뉴얼",
    description: "다시 실행할 수 있는 절차와 복구 방법",
    sections: [
      "목적과 적용 범위",
      "사전 조건",
      "실행 절차",
      "정상 동작 확인",
      "문제 해결 · 롤백",
      "참고 자료",
    ],
  },
  learning: {
    label: "학습 기록",
    description: "배운 내용을 프로젝트에서 재사용할 지식으로",
    sections: [
      "학습 주제",
      "핵심 개념",
      "직접 확인한 예시",
      "프로젝트 적용 방법",
      "아직 모르는 것",
      "출처",
    ],
  },
  project: {
    label: "프로젝트 브리프",
    description: "배포 전 프로젝트도 목적과 다음 단계부터 기록",
    sections: [
      "프로젝트 목적",
      "사용자와 핵심 기능",
      "저장소 · 실행 주소",
      "기술 구성",
      "현재 단계",
      "다음 마일스톤",
      "운영 · 문서 담당",
    ],
  },
} as const;
export type DocumentTemplate = keyof typeof DOCUMENT_TEMPLATES;
export function isDocumentTemplate(value: string): value is DocumentTemplate {
  return Object.hasOwn(DOCUMENT_TEMPLATES, value);
}
export function buildDocument(
  kind: DocumentTemplate,
  project: string,
  title: string,
  values: string[],
): string {
  const template = DOCUMENT_TEMPLATES[kind];
  return [
    `# ${title.trim()}`,
    `유형: ${template.label}`,
    `프로젝트: ${project.trim() || "공통"}`,
    ...template.sections.map(
      (section, i) =>
        `## ${section}\n\n${values[i]?.trim() || "미작성 · 확인 필요"}`,
    ),
  ].join("\n\n");
}

export function createDocumentRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
