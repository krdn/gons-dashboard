// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { MemoCard } from "./MemoCard";
import type { Memo, MemoTransformation } from "../model/types";

afterEach(cleanup);

const memo = {
  id: "m1",
  userId: "u1",
  source: "voice",
  title: "회의 메모",
  rawContent: "음 어 회의는 세 시",
  cleanedContent: "회의는 세 시",
  createdAt: new Date("2026-07-09T10:00:00"),
  updatedAt: new Date("2026-07-09T10:00:00"),
} as Memo;

const summary = {
  id: "t1",
  memoId: "m1",
  preset: "summary",
  model: "claude-sonnet-5",
  content: "요약: 회의 3시",
  presetLabel: null,
  createdAt: new Date("2026-07-09T10:05:00"),
  updatedAt: new Date("2026-07-09T10:05:00"),
} as MemoTransformation;

describe("MemoCard 검색 하이라이트 초기 뷰", () => {
  it("정리본에 일치가 없고 변환본에만 있으면 그 변환본을 초기 표시한다", () => {
    render(<MemoCard memo={memo} transformations={[summary]} highlightTerms={["3시"]} />);
    // summary.content "요약: 회의 3시" 가 초기 본문 — mark 포함
    expect(document.querySelector("mark")?.textContent).toBe("3시");
    expect(screen.queryByText("회의는 세 시")).toBeNull();
  });

  it("원문에만 일치하면(음성) 원문을 초기 표시한다", () => {
    render(<MemoCard memo={memo} transformations={[]} highlightTerms={["음 어"]} />);
    expect(document.querySelector("mark")?.textContent).toBe("음 어");
  });

  it("정리본에 일치가 있으면 기본(정리본) 유지 + 하이라이트", () => {
    render(<MemoCard memo={memo} transformations={[summary]} highlightTerms={["세 시"]} />);
    expect(document.querySelector("mark")?.textContent).toBe("세 시");
    expect(screen.queryByText(/요약:/)).toBeNull();
  });

  it("칩 클릭(사용자 오버라이드)이 파생 초기 뷰보다 우선한다", () => {
    render(<MemoCard memo={memo} transformations={[summary]} highlightTerms={["3시"]} />);
    fireEvent.click(screen.getByRole("button", { name: "정리본" }));
    expect(screen.getByText("회의는 세 시")).toBeTruthy();
  });
});

describe("MemoCard 카테고리 뱃지", () => {
  it("동적 slug 배지를 라벨 맵으로 표시한다", () => {
    render(
      <MemoCard
        memo={{ ...memo, category: "meeting-log" } as Memo}
        categoryLabels={{ "meeting-log": "회의록" }}
      />,
    );
    expect(screen.getByText("회의록")).toBeTruthy();
  });
  it("라벨 맵에 없는 slug는 slug 그대로 표시한다", () => {
    render(<MemoCard memo={{ ...memo, category: "unknown-tag" } as Memo} />);
    expect(screen.getByText("unknown-tag")).toBeTruthy();
  });
  it("미분류(null)면 뱃지를 표시하지 않는다", () => {
    render(<MemoCard memo={{ ...memo, category: null } as Memo} />);
    expect(screen.queryByText("아이디어")).toBeNull();
    expect(screen.queryByText("기타")).toBeNull();
  });
});

describe("MemoCard 칩 전환", () => {
  it("기본은 정리본을 보여준다", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    expect(screen.getByText("회의는 세 시")).toBeTruthy();
  });
  it("원문 칩 클릭 시 raw 표시 (음성만)", () => {
    render(<MemoCard memo={memo} transformations={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "원문" }));
    expect(screen.getByText("음 어 회의는 세 시")).toBeTruthy();
  });
  it("변환본 칩 클릭 시 해당 content 표시", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    fireEvent.click(screen.getByRole("button", { name: "요약" }));
    expect(screen.getByText("요약: 회의 3시")).toBeTruthy();
  });
  it("활성 칩만 aria-pressed=true (SR 사용자 현재 뷰 인지)", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    fireEvent.click(screen.getByRole("button", { name: "요약" }));
    expect(screen.getByRole("button", { name: "요약" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "정리본" }).getAttribute("aria-pressed")).toBe("false");
  });
  it("텍스트 메모 + 변환 없음이면 칩 row가 없다", () => {
    render(<MemoCard memo={{ ...memo, source: "text" } as Memo} />);
    expect(screen.queryByRole("button", { name: "정리본" })).toBeNull();
  });
  it("onTransform이 있으면 AI 정리 버튼이 memo를 넘긴다", () => {
    const onTransform = vi.fn();
    render(<MemoCard memo={memo} onTransform={onTransform} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 정리" }));
    expect(onTransform).toHaveBeenCalledWith(memo);
  });
  it("변환본 칩은 전달 순서와 무관하게 프리셋 고정 순서로 정렬된다", () => {
    // DB 조회는 순서 무보장 — 역순으로 넘겨도 summary(요약)가 todos(할 일 추출)보다 앞이어야 한다.
    const todos = { ...summary, id: "t2", preset: "todos", content: "- [ ] 회의 준비" } as MemoTransformation;
    render(<MemoCard memo={memo} transformations={[todos, summary]} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.indexOf("요약")).toBeGreaterThan(-1);
    expect(labels.indexOf("요약")).toBeLessThan(labels.indexOf("할 일 추출"));
  });
  it("커스텀 변환본은 빌트인 칩 뒤에 오고 presetLabel로 표시된다", () => {
    const custom = {
      ...summary,
      id: "t3",
      preset: "c-abc12345",
      presetLabel: "코칭",
      content: "코칭 스타일 정리본",
    } as MemoTransformation;
    render(<MemoCard memo={memo} transformations={[custom, summary]} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.indexOf("요약")).toBeLessThan(labels.indexOf("코칭"));
    fireEvent.click(screen.getByRole("button", { name: "코칭" }));
    expect(screen.getByText("코칭 스타일 정리본")).toBeTruthy();
  });
  it("presetLabel이 null인 빌트인은 코드 라벨로 폴백한다", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    expect(screen.getByRole("button", { name: "요약" })).toBeTruthy();
  });
  it("커스텀 변환본 2개는 라벨 사전순으로 정렬된다", () => {
    const coaching = {
      ...summary,
      id: "t3",
      preset: "c-bbbbbbbb",
      presetLabel: "코칭",
      content: "코칭본",
    } as MemoTransformation;
    const briefing = {
      ...summary,
      id: "t4",
      preset: "c-aaaaaaaa",
      presetLabel: "브리핑",
      content: "브리핑본",
    } as MemoTransformation;
    render(<MemoCard memo={memo} transformations={[coaching, briefing]} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.indexOf("브리핑")).toBeLessThan(labels.indexOf("코칭"));
  });
});

describe("MemoCard 삭제 2-click 확인", () => {
  it("첫 클릭은 확인 상태 전환만 하고 onDelete를 부르지 않는다", () => {
    const onDelete = vi.fn();
    render(<MemoCard memo={memo} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "정말 삭제?" })).toBeTruthy();
  });

  it("확인 상태에서 두 번째 클릭이 onDelete를 호출한다", () => {
    const onDelete = vi.fn();
    render(<MemoCard memo={memo} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "정말 삭제?" }));
    expect(onDelete).toHaveBeenCalledWith("m1");
  });

  it("3초가 지나면 확인 상태가 원복된다", () => {
    vi.useFakeTimers();
    try {
      const onDelete = vi.fn();
      render(<MemoCard memo={memo} onDelete={onDelete} />);
      fireEvent.click(screen.getByRole("button", { name: "삭제" }));
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByRole("button", { name: "삭제" })).toBeTruthy();
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MemoCard source 뱃지", () => {
  it("agent 메모는 🤖 에이전트로 표시하고 텍스트 뱃지를 겸용하지 않는다", () => {
    render(
      <MemoCard memo={{ ...memo, source: "agent" } as Memo} transformations={[]} highlightTerms={[]} />,
    );
    expect(screen.getByText("🤖 에이전트")).toBeTruthy();
    expect(screen.queryByText("✍ 텍스트")).toBeNull();
  });

  it("text 메모는 ✍ 텍스트 뱃지를 유지한다 (회귀)", () => {
    render(
      <MemoCard memo={{ ...memo, source: "text" } as Memo} transformations={[]} highlightTerms={[]} />,
    );
    expect(screen.getByText("✍ 텍스트")).toBeTruthy();
  });
});

describe("MemoCard 마크다운 렌더링", () => {
  const mdMemo = {
    ...memo,
    source: "text",
    cleanedContent: "## 오늘 할 일\n\n- 항목 하나\n\n**강조** 텍스트",
  } as Memo;

  it("검색어가 없으면 본문을 마크다운으로 렌더한다", () => {
    render(<MemoCard memo={mdMemo} />);
    expect(screen.getByRole("heading", { name: "오늘 할 일" })).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
    expect(document.querySelector("strong")?.textContent).toBe("강조");
  });

  it("검색어 하이라이트 중에는 평문+mark를 유지한다 (마크다운과 하이라이트는 동시 불가)", () => {
    render(<MemoCard memo={mdMemo} highlightTerms={["항목"]} />);
    expect(document.querySelector("mark")?.textContent).toBe("항목");
    expect(screen.queryByRole("heading", { name: "오늘 할 일" })).toBeNull();
  });

  it("음성 원문 뷰는 항상 평문으로 표시한다", () => {
    const voiceMd = { ...memo, rawContent: "## 받아쓰기 원문" } as Memo;
    render(<MemoCard memo={voiceMd} transformations={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "원문" }));
    expect(screen.queryByRole("heading", { name: "받아쓰기 원문" })).toBeNull();
    expect(screen.getByText("## 받아쓰기 원문")).toBeTruthy();
  });

  it("검색어가 제목에만 일치하면 본문은 마크다운을 유지한다", () => {
    // mdMemo.title "회의 메모"에는 "회의"가 있지만 본문에는 없다 — 본문 평문 강등 금지.
    render(<MemoCard memo={mdMemo} highlightTerms={["회의"]} />);
    expect(document.querySelector("mark")?.textContent).toBe("회의");
    expect(screen.getByRole("heading", { name: "오늘 할 일" })).toBeTruthy();
  });

  it("텍스트 메모의 단일 줄바꿈을 <br>로 보존한다 (textarea 입력 회귀)", () => {
    const multiline = { ...memo, source: "text", cleanedContent: "첫 줄\n둘째 줄" } as Memo;
    const { container } = render(<MemoCard memo={multiline} />);
    expect(container.querySelector("br")).toBeTruthy();
  });
});

describe("MemoCard 카테고리 수동 정정", () => {
  const OPTIONS = [
    { id: "idea", labelKo: "아이디어" },
    { id: "todo", labelKo: "할 일" },
  ];

  it("onChangeCategory + 옵션이 있으면 select를 렌더하고 변경을 위임한다", () => {
    const onChange = vi.fn();
    render(
      <MemoCard
        memo={{ ...memo, category: "idea" } as Memo}
        onChangeCategory={onChange}
        categoryOptions={OPTIONS}
        categoryLabels={{ idea: "아이디어", todo: "할 일" }}
      />,
    );
    const select = screen.getByRole("combobox", { name: "카테고리 변경" }) as HTMLSelectElement;
    expect(select.value).toBe("idea");
    fireEvent.change(select, { target: { value: "todo" } });
    expect(onChange).toHaveBeenCalledWith("m1", "todo");
  });

  it("미분류(null) 메모는 '미분류' placeholder에서 지정할 수 있다", () => {
    const onChange = vi.fn();
    render(
      <MemoCard
        memo={{ ...memo, category: null } as Memo}
        onChangeCategory={onChange}
        categoryOptions={OPTIONS}
      />,
    );
    const select = screen.getByRole("combobox", { name: "카테고리 변경" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "idea" } });
    expect(onChange).toHaveBeenCalledWith("m1", "idea");
  });

  it("onChangeCategory가 없으면 기존 정적 배지를 유지한다", () => {
    render(
      <MemoCard memo={{ ...memo, category: "idea" } as Memo} categoryLabels={{ idea: "아이디어" }} />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("아이디어")).toBeTruthy();
  });

  it("categoryUpdating이면 select가 비활성화된다 (중복 제출 차단)", () => {
    render(
      <MemoCard
        memo={{ ...memo, category: "idea" } as Memo}
        onChangeCategory={vi.fn()}
        categoryOptions={OPTIONS}
        categoryUpdating
      />,
    );
    const select = screen.getByRole("combobox", { name: "카테고리 변경" }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it("옵션 목록에 없는 기존 값도 select에 방어적으로 노출한다", () => {
    render(
      <MemoCard
        memo={{ ...memo, category: "meeting-log" } as Memo}
        onChangeCategory={vi.fn()}
        categoryOptions={OPTIONS}
        categoryLabels={{ "meeting-log": "회의록" }}
      />,
    );
    const select = screen.getByRole("combobox", { name: "카테고리 변경" }) as HTMLSelectElement;
    expect(select.value).toBe("meeting-log");
    expect(screen.getByRole("option", { name: "회의록" })).toBeTruthy();
  });
});
