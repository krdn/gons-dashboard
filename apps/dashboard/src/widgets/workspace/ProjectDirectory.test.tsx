// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: { value: "" } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/projects", useSearchParams: () => new URLSearchParams(query.value) }));
import { ProjectDirectory } from "./ProjectDirectory";
import type { WorkspaceProject } from "./model";
const project: WorkspaceProject = { id: "a", name: "Example", key: "example", host: "test-host", description: null, category: null, url: null, pinned: false, running: 1, total: 1, status: "running", fetchedAt: "2026-09-10T01:00:00Z" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); query.value = ""; });
it("normalizes unsupported filters so the displayed selection matches the result", () => { query.value = "status=invalid&host=missing"; render(<ProjectDirectory projects={[project]} />); expect((screen.getByLabelText("프로젝트 상태") as HTMLSelectElement).value).toBe("all"); expect(screen.getByText("Example")).toBeTruthy(); });
it("keeps typed query when applying a select filter without a server navigation", () => { const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {}); render(<ProjectDirectory projects={[project]} />); fireEvent.change(screen.getByLabelText("프로젝트 검색"), { target: { value: "Example" } }); fireEvent.change(screen.getByLabelText("프로젝트 상태"), { target: { value: "running" } }); expect(replace).toHaveBeenCalledWith(null, "", "/projects?q=Example&status=running"); });
it("does not present an unavailable source as a first-use empty directory", () => { render(<ProjectDirectory projects={[]} unavailable />); expect(screen.getByText("프로젝트 현황을 확인할 수 없습니다")).toBeTruthy(); expect(screen.queryByText("아직 연결된 프로젝트가 없습니다")).toBeNull(); });
