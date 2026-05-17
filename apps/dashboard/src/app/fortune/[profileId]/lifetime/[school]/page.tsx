// 학파 단독 LifetimeFrame 상세 페이지 (Task 7.3).
//
// 진입점: TriNationTabs → "{school} 더 보기" 링크에서 호출.
// 책임: school URL 파라미터(ko / cn-ziping / cn-mangpai / jp) 검증 후
// 해당 학파의 LifetimeFrame 만 단독 렌더. narrative fetch 는 카드 내부 useState 로 lazy.
//
// 디자인: /fortune/[profileId] 와 동일한 max-w + 디자인 토큰(--color-surface/--color-hairline) +
// aria-labelledby + h1 패턴 (Task 7.2 SajuTriLifetime widget 와 일관).
//
// 에러 처리: getOrBuildLifetime 실패 시 .then(success, failure) discriminated union 으로
// 결과를 좁힌 뒤 JSX 분기. try/catch 안에서 JSX 를 생성하지 않는다 — react-hooks/error-boundaries
// lint 규칙 준수 + 같은 파일 트리(fortune/[profileId]/page.tsx)의 yearlyResult 패턴과 일관.
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getOrBuildLifetime } from "@/features/saju-lifetime-tri/api/lifetime-server";
import { LifetimeFrameCard } from "@/features/saju-lifetime-tri";

const SCHOOL_MAP = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
} as const;

type SchoolParam = keyof typeof SCHOOL_MAP;

const SCHOOL_LABEL: Record<SchoolParam, string> = {
  ko: "한국식 자평+조후+신살",
  "cn-ziping": "중국 자평진전·적천수",
  "cn-mangpai": "중국 맹파 단건업",
  jp: "일본 추명학",
};

function isSchoolParam(value: string): value is SchoolParam {
  return value in SCHOOL_MAP;
}

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ profileId: string; school: string }>;
};

export default async function LifetimeSchoolPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { profileId, school } = await params;
  if (!isSchoolParam(school)) redirect(`/fortune/${profileId}`);

  const label = SCHOOL_LABEL[school];
  const frameKey = SCHOOL_MAP[school];

  const result = await getOrBuildLifetime(profileId, session.user.id).then(
    ({ triNation }) =>
      ({ ok: true as const, frame: triNation.frames[frameKey] }),
    (e: unknown) =>
      ({
        ok: false as const,
        error: e instanceof Error ? e.message : "분석 실패",
      }),
  );

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <section
        aria-labelledby="lifetime-school-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h1
          id="lifetime-school-heading"
          className="mb-4 text-base font-semibold"
        >
          {label} 관점 평생 풀이
        </h1>
        {result.ok ? (
          <LifetimeFrameCard
            profileId={profileId}
            schoolKey={school}
            frame={result.frame}
          />
        ) : (
          <p className="text-sm text-red-600">분석 실패: {result.error}</p>
        )}
      </section>
    </main>
  );
}
