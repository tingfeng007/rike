// Keep submitted turns recoverable without replaying failed bubbles to the model.
export function recoverOralMessages(messages = []) {
  return messages.map((message, index) => {
    if (!message.isStreaming && message.status !== 'pending') return message;
    const user = messages.slice(0, index).findLast((item) => item.role === 'user');
    return { ...message, isStreaming: false, isError: true, status: 'failed',
      userMessageId: message.userMessageId || user?.id,
      failedUserText: message.failedUserText || user?.text || '',
      replyText: '', errorTitle: '上次回复未完成',
      replyTextCn: '你的消息已保留，点击重试继续这一轮对话。' };
  });
}

export function prepareOralTurn(messages, text, { retryId, now = Date.now() } = {}) {
  const retry = retryId && messages.find((message) => message.id === retryId && message.isError);
  const retryIndex = retry ? messages.indexOf(retry) : -1;
  const existingUser = retry && (messages.find((message) => message.id === retry.userMessageId)
    || messages.slice(0, retryIndex).findLast((message) => message.role === 'user'));
  const user = existingUser || { id: `usr_${now}`, role: 'user', text: text.trim(), timestamp: now };
  const assistant = { id: retry?.id || `ai_${now + 1}`, role: 'assistant', replyText: '',
    userMessageId: user.id, failedUserText: user.text, status: 'pending', isStreaming: true, timestamp: now };
  const nextMessages = retry && existingUser
    ? messages.map((message) => message.id === retry.id ? assistant : message)
    : [...messages, user, assistant];
  const end = nextMessages.findIndex((message) => message.id === assistant.id);
  const history = nextMessages.slice(0, end).filter((message) => !message.isError && !message.isStreaming && message.status !== 'failed');
  return { messages: nextMessages, user, assistant, history };
}

export function finishOralTurn(messages, assistantId, response, now = Date.now()) {
  return messages.map((message) => message.id === assistantId
    ? { ...message, ...response, role: 'assistant', status: 'complete', isError: false, isStreaming: false, timestamp: now }
    : message);
}

export function failOralTurn(messages, assistantId, { title, tip }, now = Date.now()) {
  return finishOralTurn(messages, assistantId, { replyText: '', replyTextCn: tip,
    errorTitle: title, status: 'failed', isError: true }, now).map((message) => message.id === assistantId
    ? { ...message, status: 'failed', isError: true } : message);
}

export function correctionFromFeedback(feedback, { id, scenarioId, now = Date.now() }) {
  if (!feedback?.hasSlip || typeof feedback.userOriginal !== 'string' || typeof feedback.corrected !== 'string'
    || !feedback.userOriginal.trim() || !feedback.corrected.trim()) return null;
  return { id: `correction_${id}`, scenarioId, original: feedback.userOriginal.trim(),
    corrected: feedback.corrected.trim(), explanation: typeof feedback.explanationZh === 'string' ? feedback.explanationZh : '',
    alternative: typeof feedback.betterAlternative === 'string' ? feedback.betterAlternative : '', createdAt: now, updatedAt: now,
    nextReviewAt: now + 86400000, reviewCount: 0, status: 'learning' };
}

export function reviewOralCorrection(correction, recalled, now = Date.now()) {
  return { ...correction, reviewCount: (correction.reviewCount || 0) + 1, updatedAt: now,
    nextReviewAt: now + (recalled ? 3 : 1) * 86400000, status: recalled ? 'review' : 'learning' };
}
