// 사용자 입력(또는 seed)에 들어온 URL을 외부 링크로 안전하게 사용 가능한지 검증.
// http(s)만 허용 — javascript:, data:, file: 등 위험 스킴은 null 반환.
// `<a href={null}>` 처리는 호출 측에서 수행 (link 자체를 렌더하지 않음).
export function safeExternalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.toString();
}
