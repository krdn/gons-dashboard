// 사주 모델 선택의 지속 저장 — 쿠키 직렬화·파싱·우선순위 해석 (순수 함수).
//
// 모델 선택은 원래 URL search param 에만 있었다. 공유는 되지만 휘발성이라
// /fortune/<id> 링크(사이드바·프로필 목록·홈 카드)로 재진입하면 param 이 없어
// registry 기본값으로 되돌아갔다. app-shell 의 sidebar_collapsed 와 같은 방식으로
// 마지막 선택을 쿠키에 기억한다 — client 가 document.cookie 로 쓰고, RSC 가
// cookies() 로 읽어 초기값을 정한다 (Server Action 라운드트립 불요).
//
// 우선순위: URL param > 쿠키 > registry 기본값. **소스 단위** 로 적용한다 —
// URL 이 모델 권위를 조금이라도 담고 있으면 나머지 필드도 URL·기본값에서만 오고
// 쿠키를 섞지 않는다 (?model= 만 담긴 링크는 그 공급사의 기본값, ?modelId= 만
// 담긴 링크는 그 모델에서 공급사를 도출).
// 필드 단위로 섞으면 같은 링크가 수신자의 쿠키에 따라 다른 모델로 열린다.
// 쿠키가 URL 을 이기면 ?modelId= 가 붙은 공유 링크를 내 쿠키가 덮어써 버린다.
import {
  DEFAULT_SAJU_MODEL_KEY,
  SAJU_MODEL_KEYS,
  type SajuModelKey,
} from "@/shared/lib/llm/saju-model-registry-meta";
import {
  deriveLlmProviderFromModelId,
  isLlmModelIdForProvider,
  sanitizeLlmModelId,
} from "@/shared/lib/llm/provider-model-catalog";

export const SAJU_MODEL_COOKIE = "saju_model";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SEPARATOR = "|";

export interface SajuModelPreference {
  modelKey: SajuModelKey;
  /** 공급사만 바꾼 직후엔 null — 서버가 registry 기본 모델로 해석한다. */
  modelId: string | null;
}

/** `<provider>|<modelId?>` — 구분자 `|` 는 모델 ID 문법(MODEL_ID_RE)에 없어 충돌하지 않는다. */
export function serializeSajuModelPreference(
  preference: SajuModelPreference,
): string {
  return `${preference.modelKey}${SEPARATOR}${preference.modelId ?? ""}`;
}

/**
 * 쿠키 값을 검증된 선택 페어로 정규화. Never throws.
 * 공급사·모델 ID 가 서로 어긋나면(예: gemini|claude-opus-5) 통째로 버린다 —
 * 부분 신뢰는 UI 와 실제 호출 모델이 갈리는 상태를 만든다.
 */
export function parseSajuModelPreference(
  raw: unknown,
): SajuModelPreference | null {
  if (typeof raw !== "string") return null;
  const separatorIndex = raw.indexOf(SEPARATOR);
  if (separatorIndex < 0) return null;

  const rawKey = raw.slice(0, separatorIndex);
  if (!(SAJU_MODEL_KEYS as readonly string[]).includes(rawKey)) return null;
  const modelKey = rawKey as SajuModelKey;

  const rawId = raw.slice(separatorIndex + 1);
  if (rawId === "") return { modelKey, modelId: null };

  const modelId = sanitizeLlmModelId(rawId);
  if (modelId === null || !isLlmModelIdForProvider(modelKey, modelId)) {
    return null;
  }
  return { modelKey, modelId };
}

/** client 전용 — 선택이 바뀐 순간에만 호출한다 (렌더 중 호출 금지). */
export function writeSajuModelCookie(preference: SajuModelPreference): void {
  document.cookie = `${SAJU_MODEL_COOKIE}=${serializeSajuModelPreference(
    preference,
  )}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export interface ResolveSajuModelSelectionInput {
  /** searchParams.model 원문 (string | string[] | undefined) */
  rawModelKey: unknown;
  /** searchParams.modelId 원문 (string | string[] | undefined) */
  rawModelId: unknown;
  cookieValue: string | undefined;
  defaults: Record<SajuModelKey, string>;
}

export interface SajuModelSelection {
  modelKey: SajuModelKey;
  modelId: string;
}

function firstParam(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

/**
 * URL param · 쿠키 · registry 기본값을 우선순위대로 합쳐 유효 선택을 결정한다.
 * modelId 는 항상 modelKey 공급사 계열임이 보장된다
 * (createNarrativeHandler 의 폴백 규칙과 동일).
 */
export function resolveSajuModelSelection({
  rawModelKey,
  rawModelId,
  cookieValue,
  defaults,
}: ResolveSajuModelSelectionInput): SajuModelSelection {
  const saved = parseSajuModelPreference(cookieValue);

  // 미지의 값은 "없음" 으로 취급한다 — parseSajuModelKey 는 잘못된 입력을 기본
  // 공급사로 폴백하므로, 그대로 쓰면 ?model= 오타 하나가 저장된 공급사를 통째로
  // 무효화한다 (유효하지 않은 param 이 유효한 쿠키를 이기는 우선순위 역전).
  const rawKey = firstParam(rawModelKey);
  const urlModelKey =
    rawKey !== undefined &&
    (SAJU_MODEL_KEYS as readonly string[]).includes(rawKey)
      ? (rawKey as SajuModelKey)
      : undefined;

  const urlModelId = sanitizeLlmModelId(firstParam(rawModelId));

  // ?modelId= 만 담긴 링크도 자족적이어야 한다 — 공급사를 쿠키에서 가져오면
  // 같은 링크가 수신자마다 다른 모델로 열린다. 그래서 모델 자체에서 도출한다.
  // 도출 결과는 유일하다 (isLlmModelIdForProvider 술어가 상호 배타). 대시보드가
  // 다루지 않는 계열(프록시가 노출하는 grok-* 등)이면 null 이고, 그때는 아래
  // urlHasAuthority 규칙이 기본 공급사로 떨어뜨린다 — 지정한 모델은 버려진다.
  const derivedModelKey =
    urlModelId === null
      ? undefined
      : (deriveLlmProviderFromModelId(urlModelId) ?? undefined);

  // URL 이 모델 권위를 담고 있으면 — 공급사 키든 문법상 유효한 modelId 든 —
  // 쿠키는 일절 참여하지 않는다. 절반만 적용하면(예: 공급사를 도출하지 못한
  // 지원 밖 modelId) 같은 링크가 수신자 쿠키에 따라 다른 공급사로 열린다.
  // 공급사만 바꾸는 본인 흐름은 handleProvider 가 ?model= 세팅과 동시에 쿠키를
  // `<provider>|` 로 리셋하므로, 이 배타 규칙은 본인에게 무해하다.
  const urlHasAuthority = urlModelKey !== undefined || urlModelId !== null;
  const cookieModelKey = urlHasAuthority ? undefined : saved?.modelKey;

  const modelKey =
    urlModelKey ?? derivedModelKey ?? cookieModelKey ?? DEFAULT_SAJU_MODEL_KEY;

  if (urlModelId !== null && isLlmModelIdForProvider(modelKey, urlModelId)) {
    return { modelKey, modelId: urlModelId };
  }
  if (urlHasAuthority) {
    return { modelKey, modelId: defaults[modelKey] };
  }

  // 여기부터는 URL 에 모델 권위가 없다 — modelKey 는 쿠키(또는 기본값)에서 왔으므로
  // 쿠키 모델의 공급사 일치는 이미 보장된다.
  return { modelKey, modelId: saved?.modelId ?? defaults[modelKey] };
}
