import { Suspense, Fragment, type ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { renderEntry } from "./renderEntry";

const Dummy = () => null;
const DummySkel = () => null;

describe("renderEntry 분기", () => {
  it("Skeleton 있으면 Suspense로 감싼다", () => {
    const el = renderEntry({ id: "a", column: "main", Component: Dummy, Skeleton: DummySkel }) as ReactElement;
    expect(el.type).toBe(Suspense);
  });

  it("Skeleton 없으면 Fragment(keyed)로 렌더", () => {
    const el = renderEntry({ id: "b", column: "main", Component: Dummy }) as ReactElement;
    expect(el.type).toBe(Fragment);
  });
});
