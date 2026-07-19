// 매분 KST — 활성 호스트별 docker stats 1사이클 수집 → metric_samples.
// 이슈 #323 Phase 1 §2-B. 수집 잡이므로 scheduler catchup 대상 아님 (주의점 7).
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { runDocker, parseDockerStats } from "@/shared/lib/docker";
import { getHosts } from "@/entities/host";
import {
  insertMetricSamples,
  type NewMetricSample,
} from "@/entities/monitoring/server";

export const dynamic = "force-dynamic";

export const POST = createCronHandler({
  name: "collect-docker-stats",
  targetSelect: () => getHosts(),
  getId: (host) => host.id,
  getLabel: (host) => host.name,
  perTarget: async (host) => {
    const stdout = await runDocker(host.dockerContext, [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
    ]);
    const collectedAt = new Date();
    const rows: NewMetricSample[] = [];
    let containers = 0;
    for (const line of stdout.split("\n")) {
      if (line.trim() === "") continue;
      const sample = parseDockerStats(line);
      if (sample == null) continue; // malformed(중지 컨테이너 등) skip
      containers += 1;
      const labels = { container: sample.name };
      rows.push(
        { hostId: host.id, metric: "container.cpu_pct", value: sample.cpuPct, labels, collectedAt },
        { hostId: host.id, metric: "container.mem_pct", value: sample.memPct, labels, collectedAt },
        { hostId: host.id, metric: "container.mem_used_mb", value: sample.memUsedMb, labels, collectedAt },
      );
    }
    const inserted = await insertMetricSamples(rows);
    return { containers, inserted };
  },
});
