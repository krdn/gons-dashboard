import type { AnalysisResult } from "../model/types";
import { PERSONAS, TIMEFRAMES, PERSONA_LABEL, TIMEFRAME_LABEL } from "../model/types";
import { PerspectiveCell } from "./PerspectiveCell";

export function PerspectiveGrid({ result }: { result: AnalysisResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="p-2 text-left text-xs text-slate-400">페르소나 \ 기간</th>
            {TIMEFRAMES.map((tf) => (
              <th key={tf} className="p-2 text-left text-xs font-semibold text-slate-500">
                {TIMEFRAME_LABEL[tf]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERSONAS.map((persona) => (
            <tr key={persona}>
              <td className="p-2 align-top text-xs font-semibold text-slate-700">
                {PERSONA_LABEL[persona]}
              </td>
              {TIMEFRAMES.map((tf) => (
                <td key={tf} className="p-2 align-top">
                  <PerspectiveCell slot={result.perspectives[persona][tf]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
