// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MaintenanceIndex } from "./MaintenanceIndex";
import type { MaintenanceEntry } from "../model/types";

afterEach(cleanup);

const entries: MaintenanceEntry[] = [
  { task: "분류 프롬프트 수정", where: "classifyMemo.ts", how: "템플릿 편집" },
  { task: "cron 스케줄 변경", where: "scheduler.js", how: "crontab 문자열 수정" },
];

describe("MaintenanceIndex", () => {
  it("전체 항목을 렌더한다", () => {
    render(<MaintenanceIndex entries={entries} />);
    expect(screen.getByText("분류 프롬프트 수정")).toBeTruthy();
    expect(screen.getByText("cron 스케줄 변경")).toBeTruthy();
  });

  it("검색어로 항목을 필터한다", () => {
    render(<MaintenanceIndex entries={entries} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cron" } });
    expect(screen.queryByText("분류 프롬프트 수정")).toBeNull();
    expect(screen.getByText("cron 스케줄 변경")).toBeTruthy();
  });
});
