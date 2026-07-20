// 배포 파이프라인 히어로 카드 — 이 관제의 핵심 가치.
//
// main 에 머지했는데 Build 가 실패하면 ghcr 에 이미지가 안 올라가고
// deploy-watcher 는 조용히 넘어간다. 그 상태를 여기서 드러낸다.
import { type BuildState, type GithubSyncState } from "@/entities/github-activity/client";

const STATE_LABEL: Record<BuildState, string> = {
  synced: "빌드 성공",
  building: "빌드 진행 중",
  "build-failed": "빌드 실패",
  "no-run": "실행 없음",
  unknown: "판정 불가",
};

const STATE_TONE: Record<BuildState, string> = {
  synced: "text-emerald-700",
  building: "text-blue-700",
  "build-failed": "text-red-700",
  "no-run": "text-amber-700",
  unknown: "text-neutral-500",
};

export function BuildStateCard({ build }: { build: GithubSyncState | null }) {
  const state = build?.buildState ?? null;

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <p className="text-xs text-[var(--color-text-muted)]">main 브랜치 빌드</p>
      {state == null ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">아직 판정된 적 없음</p>
      ) : (
        <>
          <p className={`mt-1 text-2xl font-bold ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-[var(--color-text-muted)]">HEAD</dt>
              <dd className="font-mono">{build?.mainHeadSha?.slice(0, 7) ?? "—"}</dd>
            </div>
            {build?.buildRunUrl != null && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-text-muted)]">실행</dt>
                <dd>
                  <a
                    href={build.buildRunUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    GitHub 에서 보기
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}
