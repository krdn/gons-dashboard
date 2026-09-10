"use client";
import { useState } from "react";
export function DocumentExport({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const [notice, setNotice] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setNotice("복사했습니다. 전달할 AI에 붙여넣으세요.");
    } catch {
      setNotice("복사하지 못했습니다. 파일 다운로드를 사용하세요.");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80)}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Markdown 파일을 내려받았습니다.");
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="hub-button primary" onClick={copy}>
        AI에 전달할 내용 복사
      </button>
      <button className="hub-button" onClick={download}>
        .md 다운로드
      </button>
      <p role="status" className="text-text-muted text-sm">
        {notice}
      </p>
    </div>
  );
}
