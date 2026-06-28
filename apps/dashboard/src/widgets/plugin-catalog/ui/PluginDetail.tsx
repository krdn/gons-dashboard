"use client";
import type { PluginMeta } from "@/entities/plugin/client";
import { pluginStatus } from "../lib/filterPlugins";
import { PluginStatusBadge } from "./PluginStatusBadge";

function NameList({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-[var(--color-text)]">
        {title} <span className="text-[var(--color-text-subtle)]">{names.length}</span>
      </h3>
      <p className="font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        {names.join(" · ")}
      </p>
    </div>
  );
}

export function PluginDetail({ plugin }: { plugin: PluginMeta | null }) {
  if (!plugin) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-[var(--color-hairline)] text-sm text-[var(--color-text-muted)]">
        plugin 을 선택하세요.
      </div>
    );
  }

  const flags: string[] = [];
  if (plugin.counts.hooks) flags.push("Hooks ✓");
  if (plugin.counts.mcp) flags.push("MCP ✓");

  const emptyComponents =
    plugin.counts.skills === 0 &&
    plugin.counts.agents === 0 &&
    plugin.counts.commands === 0 &&
    flags.length === 0;

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-[var(--color-hairline)] bg-white p-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg text-[var(--color-text)]">{plugin.name}</h2>
          <span className="text-xs text-[var(--color-text-subtle)]">v{plugin.version}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">· {plugin.marketplace}</span>
          <PluginStatusBadge status={pluginStatus(plugin)} />
        </div>
        {plugin.description && (
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">{plugin.description}</p>
        )}
        {(plugin.author || plugin.homepage) && (
          <p className="text-xs text-[var(--color-text-subtle)]">
            {plugin.author && <span>by {plugin.author}</span>}
            {plugin.author && plugin.homepage && <span> · </span>}
            {plugin.homepage && (
              <a
                href={plugin.homepage}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-[var(--color-accent)]"
              >
                {plugin.homepage.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </p>
        )}
      </header>

      {!plugin.resolved ? (
        <p className="rounded-lg border border-dashed border-[var(--color-severity-high)] p-3 text-sm text-[var(--color-text-muted)]">
          설치 경로를 찾을 수 없습니다 — 마켓플레이스에서 제거되었거나 캐시가 갱신된 plugin 입니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <NameList title="Skills" names={plugin.components.skills} />
          <NameList title="Agents" names={plugin.components.agents} />
          <NameList title="Commands" names={plugin.components.commands} />
          {flags.length > 0 && (
            <p className="flex gap-2 text-xs text-[var(--color-text-muted)]">
              {flags.map((f) => (
                <span key={f} className="rounded bg-[var(--color-surface-2)] px-2 py-1">
                  {f}
                </span>
              ))}
            </p>
          )}
          {emptyComponents && (
            <p className="text-sm text-[var(--color-text-subtle)]">
              노출된 구성요소가 없습니다 (LSP·런타임 전용 plugin).
            </p>
          )}
        </div>
      )}

      {plugin.keywords.length > 0 && (
        <footer className="flex flex-wrap gap-1 border-t border-[var(--color-hairline)] pt-3">
          {plugin.keywords.map((k) => (
            <span
              key={k}
              className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-subtle)]"
            >
              {k}
            </span>
          ))}
        </footer>
      )}
    </article>
  );
}
