// Web Speech 결과 누적 — 순수 로직 (훅에서 분리해 테스트 가능하게).
// 핵심: event.resultIndex부터만 순회하고 isFinal만 append (중복 누적 방지).
interface ResultLike {
  0: { transcript: string };
  isFinal: boolean;
  length: number;
}

export function accumulateFinal(
  prevFinal: string,
  event: { resultIndex: number; results: ArrayLike<ResultLike> },
): { finalText: string; interim: string } {
  let finalText = prevFinal;
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const r = event.results[i];
    const transcript = r[0].transcript;
    if (r.isFinal) {
      finalText += transcript;
    } else {
      interim += transcript;
    }
  }
  return { finalText, interim };
}
