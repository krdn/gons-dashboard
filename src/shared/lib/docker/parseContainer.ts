import { z } from "zod";

const ContainerStateSchema = z.enum([
  "running",
  "exited",
  "restarting",
  "paused",
  "dead",
  "created",
]);
export type ContainerState = z.infer<typeof ContainerStateSchema>;

export type PortMapping = {
  host: string | null;
  hostPort: number | null;
  container: number;
  protocol: "tcp" | "udp";
};

export type ContainerSummary = {
  id: string;
  name: string;
  hostId: string;
  composeProject: string | null;
  composeService: string | null;
  state: ContainerState;
  statusText: string;
  uptimeSeconds: number | null;
  image: string;
  ports: PortMapping[];
  createdAt: string;
};

const RawContainerSchema = z.object({
  ID: z.string().min(1),
  Names: z.string().min(1),
  State: ContainerStateSchema,
  Status: z.string(),
  Image: z.string(),
  Ports: z.string(),
  Labels: z.string(),
  CreatedAt: z.string(),
});

// 단순 CSV — value 내 comma는 지원 안 함 (compose 라벨에는 없음)
function parseLabels(csv: string): Record<string, string> {
  if (!csv) return {};
  const out: Record<string, string> = {};
  for (const part of csv.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parsePorts(s: string): PortMapping[] {
  if (!s) return [];
  // 예: "0.0.0.0:8000->8000/tcp" 또는 노출만 "8000/tcp"
  // 한계 (v0.1): IPv6 dual-stack(:::), 포트 범위(5000-5005)는 지원 안 함 — silently drop.
  const out: PortMapping[] = [];
  for (const raw of s.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(
      /^(?:(?<host>[^:]+):(?<hostPort>\d+)->)?(?<container>\d+)\/(?<proto>tcp|udp)$/,
    );
    if (m && m.groups) {
      out.push({
        host: m.groups.host ?? null,
        hostPort: m.groups.hostPort ? Number(m.groups.hostPort) : null,
        container: Number(m.groups.container),
        protocol: m.groups.proto as "tcp" | "udp",
      });
    }
  }
  return out;
}

function parseUptimeSeconds(status: string): number | null {
  // "Up 3 days", "Up 12 minutes", "Up 5 hours". Exited은 null.
  const m = status.match(/^Up\s+(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?)/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit.startsWith("second")) return n;
  if (unit.startsWith("minute")) return n * 60;
  if (unit.startsWith("hour")) return n * 3600;
  if (unit.startsWith("day")) return n * 86_400;
  if (unit.startsWith("week")) return n * 7 * 86_400;
  return null;
}

export function parseContainer(raw: unknown, hostId: string): ContainerSummary {
  const r = RawContainerSchema.parse(raw);
  const labels = parseLabels(r.Labels);
  return {
    id: r.ID,
    name: r.Names.split(",")[0].trim(),
    hostId,
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeService: labels["com.docker.compose.service"] ?? null,
    state: r.State,
    statusText: r.Status,
    uptimeSeconds: parseUptimeSeconds(r.Status),
    image: r.Image,
    ports: parsePorts(r.Ports),
    createdAt: r.CreatedAt,
  };
}
