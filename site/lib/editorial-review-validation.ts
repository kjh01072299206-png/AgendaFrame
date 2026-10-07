import type { EditorialIssue } from "./editorial-review";

export function editorialReviewIsPublishable(issue: EditorialIssue): boolean {
  const ids = issue.articles.map(a => a.articleId);
  const assigned = issue.groups.flatMap(g => g.articleIds);
  const grounded = (paragraph: { text: string; articleIds: string[] }, allowed: string[] = ids) =>
    paragraph.text.trim().length > 0 && paragraph.articleIds.length > 0
    && paragraph.articleIds.every(id => allowed.includes(id));
  return issue.groups.length >= 2
    && issue.eventParagraphs.length >= 4 && issue.eventParagraphs.length <= 6
    && issue.eventParagraphs.every(p => grounded(p))
    && issue.terms.every(t => grounded({ text: t.description, articleIds: t.articleIds }))
    && issue.articleCount === ids.length
    && new Set(ids).size === ids.length
    && assigned.length === ids.length
    && new Set(assigned).size === assigned.length
    && assigned.every(id => ids.includes(id))
    && issue.outletCount === new Set(issue.articles.map(a => a.outlet)).size
    && issue.articles.every(a => /^[a-f0-9]{64}$/.test(a.bodySha256)
      && /^https:\/\//.test(a.url)
      && a.evidence.length > 0
      && a.evidence.every(e => e.end > e.start && /^[a-f0-9]{64}$/.test(e.sha256))
      && Object.values(a.fourFunctions).length === 4
      && Object.values(a.fourFunctions).every(v => v.trim().length > 0))
    && issue.groups.every(g => g.articleCount > 0
      && g.explanationParagraphs.length > 0
      && g.explanationParagraphs.every(p => grounded(p, g.articleIds))
      && g.articleCount === g.articleIds.length
      && g.articleIds.every(id => issue.articles.some(a => a.articleId === id && a.groupId === g.id))
      && g.outlets.length === new Set(issue.articles.filter(a => a.groupId === g.id).map(a => a.outlet)).size
      && g.outlets.every(outlet => issue.articles.some(a => a.groupId === g.id && a.outlet === outlet)));
}
