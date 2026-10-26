// Explanation records live separately from the bounded conversation history.
export function pageKey(documentId, page) {
  return `${documentId}:${Number(page)}`;
}

export function pageExplanationsOf(course) {
  const records = new Map();
  for (const message of course.chat || []) {
    if (message.kind !== "explain" || !message.text?.trim()) continue;
    records.set(pageKey(message.documentId, message.page), {
      documentId: message.documentId,
      page: Number(message.page),
      text: message.text,
      explainedAt: message.createdAt || course.updatedAt,
      ...(message.usedPageImage ? { usedPageImage: true } : {}),
    });
  }
  for (const record of course.pageExplanations || []) {
    if (record.text?.trim()) records.set(pageKey(record.documentId, record.page), record);
  }
  return [...records.values()];
}

export function explainedPagesOf(course) {
  return pageExplanationsOf(course).map(({ documentId, page, explainedAt }) => ({ documentId, page, explainedAt, chatRevision: pageChatRevision(course, documentId, page) }));
}

export function studyPages(course) {
  const explanations = new Map(pageExplanationsOf(course).map((record) => [pageKey(record.documentId, record.page), record]));
  return (course.documents || []).flatMap((document) => (document.pages || []).flatMap((page) => {
    const text = String(page.text || "").trim();
    const canExplain = Boolean(text && !text.startsWith("[No extractable text"));
    const isPdf = document.extension === ".pdf";
    if (!isPdf && !canExplain) return [];
    const explanation = explanations.get(pageKey(document.id, page.number));
    return [{
      documentId: document.id,
      documentName: document.originalName || document.name,
      number: page.number,
      label: page.label || `${document.pageUnit || "page"} ${page.number}`,
      unit: document.pageUnit || "page",
      isPdf,
      canExplain,
      text: canExplain ? text : "",
      explained: Boolean(explanation),
      explainedAt: explanation?.explainedAt || null,
      explanation: explanation?.text || "",
      explanationUsedPageImage: Boolean(explanation?.usedPageImage),
      chatRevision: pageChatRevision(course, document.id, page.number),
      autoExplain: !course.pageChatResets?.[pageKey(document.id, page.number)],
    }];
  }));
}

export function pageChatRevision(course, documentId, page) {
  return course.pageChatResets?.[pageKey(documentId, page)]?.revision || 0;
}

export function pageChatHistory(course, documentId, page) {
  return (course.chat || []).filter((message) => message.documentId === documentId && message.page === Number(page));
}

// Recent questions are drawn from the same bounded chat history shown to the student.
export function recentQuestionsOf(course, excludePage = null) {
  if (course.learner?.useRecentQuestions === false) return [];
  return (course.chat || [])
    .filter((message) => message.role === "student" && message.kind === "question" && message.text?.trim()
      && (!excludePage || message.documentId !== excludePage.documentId || message.page !== excludePage.number))
    .slice(-6)
    .map((message) => ({ id: message.id, documentId: message.documentId, page: message.page,
      documentName: course.documents?.find((document) => document.id === message.documentId)?.originalName || "Document",
      text: message.text.slice(0, 400) }));
}

export function taughtPageCounts(course) {
  const explained = new Set(pageExplanationsOf(course).map((record) => pageKey(record.documentId, record.page)));
  return new Map((course.documents || []).map((document) => [document.id,
    (document.pages || []).filter((page) => explained.has(pageKey(document.id, page.number))).length,
  ]));
}

export function resetPageChat(course, documentId, page) {
  const key = pageKey(documentId, page);
  course.pageExplanations = pageExplanationsOf(course).filter((record) => pageKey(record.documentId, record.page) !== key);
  course.chat = (course.chat || []).filter((message) => pageKey(message.documentId, message.page) !== key);
  course.pageChatResets ||= {};
  course.pageChatResets[key] = { revision: pageChatRevision(course, documentId, page) + 1, resetAt: new Date().toISOString() };
}
