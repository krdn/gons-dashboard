import { Suspense, Fragment, createElement, type ReactNode } from "react";
import { type WidgetEntry } from "./registry";

export function renderEntry(entry: WidgetEntry): ReactNode {
  const body = createElement(entry.Component);
  if (entry.Skeleton) {
    return createElement(
      Suspense,
      { key: entry.id, fallback: createElement(entry.Skeleton) },
      body,
    );
  }
  return createElement(Fragment, { key: entry.id }, body);
}
