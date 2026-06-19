"use client";

import { useActionState, useState } from "react";
import {
  RELATION_LABEL,
  RELATIONS,
  type FortuneProfile,
} from "@/entities/fortune-profile/client";
import {
  createFortuneProfile,
  deleteFortuneProfile,
  type FortuneProfileActionResult,
  updateFortuneProfile,
} from "@/features/fortune-profile-manage";

type Props =
  | { mode: "create"; onDone: () => void }
  | { mode: "edit"; profile: FortuneProfile; onDone: () => void };

async function createAdapter(
  _prev: FortuneProfileActionResult | null,
  formData: FormData,
): Promise<FortuneProfileActionResult> {
  return createFortuneProfile(formData);
}

async function updateAdapter(
  _prev: FortuneProfileActionResult | null,
  formData: FormData,
): Promise<FortuneProfileActionResult> {
  return updateFortuneProfile(formData);
}

async function deleteAdapter(
  _prev: FortuneProfileActionResult | null,
  formData: FormData,
): Promise<FortuneProfileActionResult> {
  return deleteFortuneProfile(formData);
}

const inputCls =
  "w-full rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";
const labelCls = "text-xs font-medium text-[var(--color-text-muted)]";

export function FortuneProfileForm(props: Props) {
  const action = props.mode === "create" ? createAdapter : updateAdapter;
  const [state, formAction, pending] = useActionState<
    FortuneProfileActionResult | null,
    FormData
  >(action, null);
  const [deleteState, deleteAction, deletePending] = useActionState<
    FortuneProfileActionResult | null,
    FormData
  >(deleteAdapter, null);

  const initial = props.mode === "edit" ? props.profile : null;

  // 성공 시 폼 닫기.
  if (state?.ok || deleteState?.ok) {
    queueMicrotask(props.onDone);
  }

  const err = state && !state.ok ? state : null;
  const delErr = deleteState && !deleteState.ok ? deleteState : null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="name">
            이름 *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={50}
            defaultValue={initial?.name ?? ""}
            placeholder="홍길동"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="nameHanja">
            한자 이름
          </label>
          <input
            id="nameHanja"
            name="nameHanja"
            type="text"
            maxLength={20}
            defaultValue={initial?.nameHanja ?? ""}
            placeholder="洪吉童"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="relation">
          나와의 관계 *
        </label>
        <select
          id="relation"
          name="relation"
          required
          defaultValue={initial?.relation ?? "self"}
          className={inputCls}
        >
          {RELATIONS.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="birthDate">
            생년월일 *
          </label>
          <input
            id="birthDate"
            name="birthDate"
            type="date"
            required
            defaultValue={initial?.birthDate ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="birthTime">
            출생 시각
          </label>
          <input
            id="birthTime"
            name="birthTime"
            type="time"
            defaultValue={initial?.birthTime ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <fieldset>
          <legend className={labelCls}>양/음력 *</legend>
          <div className="mt-1 flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="calendar"
                value="solar"
                defaultChecked={(initial?.calendar ?? "solar") === "solar"}
                required
              />
              양력
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="calendar"
                value="lunar"
                defaultChecked={initial?.calendar === "lunar"}
              />
              음력
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend className={labelCls}>성별 *</legend>
          <div className="mt-1 flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="gender"
                value="male"
                defaultChecked={initial?.gender === "male"}
                required
              />
              남성
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="gender"
                value="female"
                defaultChecked={initial?.gender === "female"}
              />
              여성
            </label>
          </div>
        </fieldset>
      </div>

      <div>
        <label className={labelCls} htmlFor="birthCity">
          출생 도시
        </label>
        <input
          id="birthCity"
          name="birthCity"
          type="text"
          maxLength={50}
          defaultValue={initial?.birthCity ?? ""}
          placeholder="서울"
          className={inputCls}
        />
      </div>

      {err && (
        <p className="text-xs text-red-600">
          저장 실패: {err.message ?? err.code}
        </p>
      )}
      {delErr && (
        <p className="text-xs text-red-600">
          삭제 실패: {delErr.message ?? delErr.code}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={props.onDone}
          className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
        >
          취소
        </button>
        <div className="flex gap-2">
          {props.mode === "edit" && (
            <ConfirmDeleteButton
              profileId={initial!.id}
              formAction={deleteAction}
              pending={deletePending}
            />
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "저장 중…" : props.mode === "create" ? "추가" : "수정"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ConfirmDeleteButton({
  profileId,
  formAction,
  pending,
}: {
  profileId: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
      >
        삭제
      </button>
    );
  }
  return (
    <form
      action={(fd) => {
        fd.set("id", profileId);
        formAction(fd);
      }}
      className="inline-flex items-center gap-2"
    >
      <span className="text-xs text-red-600">정말 삭제할까요?</span>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-[var(--color-hairline)] px-2 py-1 text-xs"
      >
        취소
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "삭제 중…" : "삭제"}
      </button>
    </form>
  );
}
