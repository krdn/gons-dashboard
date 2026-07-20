// 이벤트 소스 → 알림 클릭 시 열릴 앱 내부 경로 (이슈 #323).
// GitHub 이벤트를 /monitoring 으로 보내면 사용자가 탭을 한 번 더 눌러야 한다.
export function linkForSource(source: string): string {
  return source === "github" ? "/monitoring/github" : "/monitoring";
}
