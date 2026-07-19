// 수집 시점 인라인 임계값 평가 (이슈 #323 §3 — 별도 평가 루프 없음).
// 값이 존재하는 항목마다 verdict 를 항상 반환한다 — 호출부(ingestVitals)가
// violated=true 는 recordEvent, false 는 resolveEvent 신호로 사용 (플래핑 해소).
import { type VitalsPayload } from "../model/vitalsSchema";

export type VitalsVerdict =
  | {
      dedupKeySuffix: string;
      violated: true;
      severity: "critical" | "warning";
      title: string;
      detail?: string;
    }
  | { dedupKeySuffix: string; violated: false };

interface Tier {
  warn: number;
  crit: number;
}

// 이슈 #323 §2-A 임계값(기존 텔레그램 스크립트 계승) + critical 단계 확장.
const CPU: Tier = { warn: 90, crit: 97 };
const MEM: Tier = { warn: 90, crit: 95 };
const DISK: Tier = { warn: 85, crit: 95 };
const TEMP: Tier = { warn: 80, crit: 90 };
const GPU_VRAM: Tier = { warn: 90, crit: 97 };
const GPU_TEMP: Tier = { warn: 85, crit: 90 };

function tiered(
  suffix: string,
  value: number,
  tier: Tier,
  label: string,
  unit: string,
): VitalsVerdict {
  const severity =
    value >= tier.crit ? "critical" : value >= tier.warn ? "warning" : null;
  if (severity == null) return { dedupKeySuffix: suffix, violated: false };
  const threshold = severity === "critical" ? tier.crit : tier.warn;
  return {
    dedupKeySuffix: suffix,
    violated: true,
    severity,
    title: `${label} ${Math.round(value * 10) / 10}${unit} (임계 ${threshold}${unit})`,
  };
}

export function evaluateVitals(p: VitalsPayload): VitalsVerdict[] {
  const verdicts: VitalsVerdict[] = [
    tiered("cpu", p.cpuPct, CPU, "CPU 사용률", "%"),
    tiered("mem", p.memUsedPct, MEM, "메모리 사용률", "%"),
  ];

  for (const disk of p.disks) {
    verdicts.push(
      tiered(`disk:${disk.mount}`, disk.usedPct, DISK, `디스크 ${disk.mount} 사용률`, "%"),
    );
  }

  if (p.cpuTempC != null) {
    verdicts.push(tiered("temp", p.cpuTempC, TEMP, "CPU 온도", "°C"));
  }

  if (p.gpu != null) {
    verdicts.push(
      tiered("gpu.vram", p.gpu.vramPct, GPU_VRAM, "GPU VRAM 사용률", "%"),
      tiered("gpu.temp", p.gpu.tempC, GPU_TEMP, "GPU 온도", "°C"),
    );
  }

  verdicts.push(
    p.rebootRequired
      ? {
          dedupKeySuffix: "reboot",
          violated: true,
          severity: "warning",
          title: "재부팅 대기 중 (/var/run/reboot-required)",
        }
      : { dedupKeySuffix: "reboot", violated: false },
  );

  return verdicts;
}
