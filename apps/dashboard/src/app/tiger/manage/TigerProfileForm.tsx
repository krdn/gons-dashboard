"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTigerProfile, updateTigerProfile, deleteTigerProfile } from "@/features/tiger-profile-manage";
import { RELATION_VALUES } from "@/entities/tiger-reading";
import type { PlaymcpProfileRow } from "@/entities/tiger-reading";

type Props =
  | { mode: "create"; profile?: never }
  | { mode: "edit"; profile: PlaymcpProfileRow };

export function TigerProfileForm({ mode, profile }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true); setError(null);
    const result = mode === "create"
      ? await createTigerProfile(formData)
      : await updateTigerProfile(profile.id, formData);
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? result.code);
      return;
    }
    router.refresh();
  }

  async function onDelete() {
    if (mode !== "edit") return;
    if (!confirm(`'${profile.nickname}' 프로필을 삭제할까요? 캐시된 모든 분석이 함께 삭제됩니다.`)) return;
    setPending(true);
    const result = await deleteTigerProfile(profile.id);
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? result.code);
      return;
    }
    router.refresh();
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <Field label="닉네임" name="nickname" defaultValue={profile?.nickname} required />
      <SelectField label="관계" name="relation" defaultValue={profile?.relation ?? "self"} options={[...RELATION_VALUES]} />
      <Field label="생년월일 (YYYY-MM-DD)" name="birthDate" defaultValue={profile?.birthDate} required />
      <SelectField label="달력" name="calendar" defaultValue={profile?.calendar ?? "solar"} options={["solar", "lunar"]} />
      <SelectField label="성별" name="gender" defaultValue={profile?.gender ?? "male"} options={["male", "female"]} />
      <Field label="생시 (HH:MM, 선택)" name="birthTime" defaultValue={profile?.birthTime ?? ""} />
      <Field label="출생 도시 (선택)" name="birthCity" defaultValue={profile?.birthCity ?? ""} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "처리 중..." : mode === "create" ? "등록" : "수정"}
        </button>
        {mode === "edit" && (
          <button type="button" onClick={onDelete} disabled={pending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700">
            삭제
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, name, defaultValue, required }: { label: string; name: string; defaultValue?: string | null; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} required={required} className="mt-1 w-full rounded border px-2 py-1.5" />
    </label>
  );
}

function SelectField({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: string[] }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <select name={name} defaultValue={defaultValue} className="mt-1 w-full rounded border px-2 py-1.5">
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );
}
