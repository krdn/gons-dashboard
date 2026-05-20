// RSC-safe wrapper. children 이 async server component 일 수 있으므로 반드시 RSC 로 유지.
// 'use client' 추가 금지.

import type { ReactNode } from "react";
import { panelId, tabId } from "./ids";

interface TabPanelProps {
  tabKey: string;
  idPrefix: string;
  children: ReactNode;
}

export function TabPanel({ tabKey, idPrefix, children }: TabPanelProps) {
  return (
    <section
      role="tabpanel"
      id={panelId(tabKey, idPrefix)}
      aria-labelledby={tabId(tabKey, idPrefix)}
      tabIndex={0}
      className="focus:outline-none"
    >
      {children}
    </section>
  );
}
