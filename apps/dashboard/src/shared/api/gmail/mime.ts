// Gmail messages.get/threads.get payload → 본문 텍스트 추출 (순수 함수).
// text/plain 우선, 없으면 HTML strip. 인용부(이전 메일 인용)는 절단.

export interface GmailPayload {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
  headers?: { name: string; value: string }[];
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 인용부 절단: "On … wrote:" 또는 연속 "> " 라인 이후를 버린다.
function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;
    if (/^-----Original Message-----/i.test(line)) break;
    if (/^\s*>/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

// payload 트리에서 첫 text/plain (없으면 첫 text/html) 데이터를 찾는다.
function findPart(
  payload: GmailPayload,
  mimeType: string,
): GmailPayload | null {
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

export function extractBodyText(payload: GmailPayload): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    return stripQuoted(decodeBase64Url(plain.body.data));
  }
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    return stripQuoted(stripHtml(decodeBase64Url(html.body.data)));
  }
  return "";
}
