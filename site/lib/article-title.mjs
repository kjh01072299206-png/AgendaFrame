/** Public title rules: never use body/description as a headline fallback. */

const MAX_PUBLIC_TITLE_CHARS = 120;
const BODY_LIKE_SENTENCE = /[.!?。]|다\.|했다|밝혔다|말했다|것으로|따르면/;

export function inspectPublicTitle(value) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!title) {
    return { ok: false, reason: "empty", title: "", status: "titleUnavailable" };
  }
  if (title.length > MAX_PUBLIC_TITLE_CHARS) {
    return { ok: false, reason: "too_long", title, status: "titleUnavailable" };
  }
  const sentences = title.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sentences.length >= 2 && title.length > 80) {
    return { ok: false, reason: "multi_sentence", title, status: "titleUnavailable" };
  }
  if (title.length > 80 && BODY_LIKE_SENTENCE.test(title)) {
    return { ok: false, reason: "body_like", title, status: "titleUnavailable" };
  }
  return { ok: true, reason: null, title, status: "headline" };
}

export function publicTitleOrUnavailable(value) {
  const inspected = inspectPublicTitle(value);
  return inspected.ok ? inspected.title : "제목 확인 불가";
}

export function isBodyCarrierKey(key) {
  return [
    "bodytext",
    "raw_body",
    "rawbody",
    "articlebody",
    "content",
    "html",
    "sentencetext",
    "full_article",
    "article_content",
    "full_content",
    "prompt_payload",
    "evidence_text",
  ].includes(String(key ?? "").toLowerCase().replace(/[_-]/g, ""));
}
