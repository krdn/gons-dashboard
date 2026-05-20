// outer/inner 탭 ID 충돌 방지용 헬퍼. 사주 프로필 outer 탭은 "fortune" prefix,
// 기존 inner TriNationTabs / TriYearlyTabs / TriMonthlyTabs 는 "tri" prefix.

export function tabId(key: string, prefix: string): string {
  return `${prefix}-tab-${key}`;
}

export function panelId(key: string, prefix: string): string {
  return `${prefix}-panel-${key}`;
}
