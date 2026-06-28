// plugin entity — server-only entrypoint.
// RSC, scripts 에서 사용. plugin-catalog.json 은 빌드 시점 committed 메타데이터.
import "server-only";

import catalog from "./plugin-catalog.json";
import type { PluginCatalog, PluginMeta, PluginMarketplaceMeta } from "./model/types";

const data = catalog as PluginCatalog;

export function getPlugins(): PluginMeta[] {
  return data.plugins;
}

export function getPluginMarketplaces(): Record<string, PluginMarketplaceMeta> {
  return data.marketplaces;
}

export type { PluginMeta, PluginMarketplaceMeta, PluginStatus } from "./model/types";
