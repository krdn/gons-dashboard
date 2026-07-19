// `docker stats --no-stream --format "{{json .}}"` 한 줄 파싱.
// malformed(중지 컨테이너의 "--" 포함)는 null — 호출부가 skip.
export interface DockerStatsSample {
  name: string;
  cpuPct: number; // multi-core 는 100 초과 가능 (예: 280.5)
  memPct: number;
  memUsedMb: number; // MiB 환산
}

// MemUsage 단위 → MiB 계수. docker 는 binary 단위(KiB/MiB/GiB) 를 쓰지만
// 방어적으로 decimal(kB/MB/GB) 도 근사 지원.
const UNIT_TO_MIB: Record<string, number> = {
  b: 1 / 1024 ** 2,
  kib: 1 / 1024,
  mib: 1,
  gib: 1024,
  tib: 1024 ** 2,
  kb: 1 / 1024,
  mb: 1,
  gb: 1024,
  tb: 1024 ** 2,
};

function parseSizeMib(s: string): number | null {
  const m = /^([\d.]+)\s*([a-zA-Z]+)$/.exec(s.trim());
  if (!m) return null;
  const factor = UNIT_TO_MIB[m[2].toLowerCase()];
  if (factor == null) return null;
  const value = Number.parseFloat(m[1]);
  return Number.isFinite(value) ? value * factor : null;
}

function parsePct(s: string): number | null {
  const m = /^([\d.]+)%$/.exec(s.trim());
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseDockerStats(dockerStatsJsonLine: string): DockerStatsSample | null {
  let raw: unknown;
  try {
    raw = JSON.parse(dockerStatsJsonLine);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw == null) return null;
  const o = raw as Record<string, unknown>;

  const name = typeof o.Name === "string" && o.Name.length > 0 ? o.Name : null;
  const cpuPct = typeof o.CPUPerc === "string" ? parsePct(o.CPUPerc) : null;
  const memPct = typeof o.MemPerc === "string" ? parsePct(o.MemPerc) : null;
  const memUsedMb =
    typeof o.MemUsage === "string" ? parseSizeMib(o.MemUsage.split("/")[0]) : null;

  if (name == null || cpuPct == null || memPct == null || memUsedMb == null) {
    return null;
  }
  return { name, cpuPct, memPct, memUsedMb };
}
