import { TEN_GOD_KO, type TenGod, type TenGodAssignment } from "@gons/saju";

function Cell({ tg }: { tg: TenGod | null | "self" }) {
  if (tg === "self") return <td className="p-2 text-center text-xs text-[var(--color-text-subtle)]">─</td>;
  if (tg === null) return <td className="p-2 text-center text-xs text-[var(--color-text-subtle)]">—</td>;
  return (
    <td className="p-2 text-center text-xs">
      <span style={{ fontFamily: "var(--font-hanja)" }} lang="ko-Hani">{tg}</span>
      <span className="ml-1 text-[var(--color-text-subtle)]">({TEN_GOD_KO[tg]})</span>
    </td>
  );
}

export interface SajuTenGodsTableProps {
  tenGods: TenGodAssignment;
}

export function SajuTenGodsTable({ tenGods }: SajuTenGodsTableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-[var(--color-text-muted)]">
          <th scope="col" className="p-2 text-left font-medium">위치</th>
          <th scope="col" className="p-2 font-medium">시</th>
          <th scope="col" className="p-2 font-medium">일</th>
          <th scope="col" className="p-2 font-medium">월</th>
          <th scope="col" className="p-2 font-medium">연</th>
        </tr>
      </thead>
      <tbody className="border-t border-[var(--color-hairline)]">
        <tr>
          <th scope="row" className="p-2 text-left text-xs text-[var(--color-text-muted)] font-medium">천간</th>
          <Cell tg={tenGods.hourStem} />
          <Cell tg="self" />
          <Cell tg={tenGods.monthStem} />
          <Cell tg={tenGods.yearStem} />
        </tr>
        <tr className="border-t border-[var(--color-hairline)]">
          <th scope="row" className="p-2 text-left text-xs text-[var(--color-text-muted)] font-medium">지지</th>
          <Cell tg={tenGods.hourBranch} />
          <Cell tg={tenGods.dayBranch} />
          <Cell tg={tenGods.monthBranch} />
          <Cell tg={tenGods.yearBranch} />
        </tr>
      </tbody>
    </table>
  );
}
