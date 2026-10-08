import { useStudyClock } from '../hooks/useStudyClock';
import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Languages,
  RotateCcw,
  Sparkles,
  BookmarkPlus,
  CheckCircle2,
  Flame,
  Target,
  Trophy,
  Key,
  X,
  ExternalLink,
  AlertCircle,
  Search,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SCENARIOS } from '../data/scenarios';
import { StorageService } from '../services/storage';
import { getOralCoachResponseStream } from '../services/ai';
import { containsTerm } from '../services/text';
import { useToast } from './ui/toastContext';
import { BottomSheet, Modal } from './ui/Modal';
import { tts, stt } from '../services/speech';
import StudyHeader from './StudyHeader';
import { recoverOralMessages, prepareOralTurn, finishOralTurn, failOralTurn, correctionFromFeedback } from '../services/oralSession';
import OralCorrections from './OralCorrections';

// Diagnostic helper for friendly error categorization
function diagnoseErrorMessage(errMsg) {
  const lower = (errMsg || '').toLowerCase();
  if (lower.includes('api key') || lower.includes('401') || lower.includes('unauthorized')) {
    return {
      title: 'API Key 无效或未正确配置',
      tip: '请在“设置”中检查 API Key 是否准确无误、是否误带空格或密钥已被吊销。',
    };
  }
  if (lower.includes('429') || lower.includes('quota') || lower.includes('rate limit') || lower.includes('insufficient')) {
    return {
      title: '请求额度受限或余额不足',
      tip: 'AI 服务商提示请求频次超限或账户额度已耗尽，建议稍候片刻再试或充值。',
    };
  }
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('timeout') || lower.includes('abort')) {
    return {
      title: '网络连接出现微弱波动',
      tip: '未能顺畅连通 AI 服务器，请检查手机网络或 Wi-Fi 连接状态。',
    };
  }
  return {
    title: '对话遇到了一点小状况',
    tip: errMsg || '服务响应超时，您的输入已妥善留存，点击下方按钮即可一键重新发送。',
  };
}

function pickWantedWords() {
  const words = StorageService.getVocabulary();
  const unmastered = words.filter((word) => word.status !== 'mastered');
  const pool = unmastered.length >= 3 ? unmastered : words;
  return [...pool].sort(() => 0.5 - Math.random()).slice(0, 3);
}

function currentTimestamp() {
  return Date.now();
}

function loadScenarioMessages(scenario) {
  const history = StorageService.getChatMessages(scenario.id);
  if (history.length > 0) return recoverOralMessages(history);
  return [{
    id: `init_${scenario.id}`,
    role: 'assistant',
    replyText: scenario.initialMessage,
    replyTextCn: scenario.initialMessageCn,
    timestamp: currentTimestamp(),
  }];
}

export default function OralCoach({ onNavigateToVocab, onNavigate = () => {}, intent = null }) {
  const toast = useToast();
  const studyClock = useStudyClock();
  const [currentScenario, setCurrentScenario] = useState(() => {
    const saved = StorageService.getSettings().currentScenarioId;
    return SCENARIOS.find((s) => s.id === saved) || SCENARIOS[0];
  });

  const [messages, setMessages] = useState(() => loadScenarioMessages(currentScenario));
  const [inputText, setInputText] = useState(() => StorageService.getLearningSession(`oral:${currentScenario.id}`).draft || '');
  const [dataError, setDataError] = useState('');
  const [showCorrections, setShowCorrections] = useState(false);
  const [correctionIds, setCorrectionIds] = useState(() => new Set(StorageService.getOralCorrections().map((item) => item.id)));
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeakingId, setIsSpeakingId] = useState(null);
  const [revealedCnIds, setRevealedCnIds] = useState({});
  const [practiceWithVocab, setPracticeWithVocab] = useState(true);
  const [addedWordFeedback, setAddedWordFeedback] = useState({});
  const [activatedWords, setActivatedWords] = useState({});
  const [missionToast, setMissionToast] = useState(null);
  const [wantedWordsList, setWantedWordsList] = useState(() => pickWantedWords());
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(StorageService.getSettings().apiKey?.trim()));
  const [showQuickKeyModal, setShowQuickKeyModal] = useState(false);
  const [quickKeyInput, setQuickKeyInput] = useState('');
  const [showMicHelp, setShowMicHelp] = useState(false);
  const [showPracticeOptions, setShowPracticeOptions] = useState(false);
  const [micHelpReason, setMicHelpReason] = useState('unsupported');

  // Randomly refresh wanted words
  const refreshWantedWords = () => {
    setWantedWordsList(pickWantedWords());
  };

  const messagesEndRef = useRef(null);
  const transcriptRef = useRef('');
  const sendAfterRecognitionRef = useRef(false);
  const streamAbortRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const isSttSupported = stt.isSupported();

  useEffect(() => {
    let alive = true;
    Promise.resolve(StorageService.saveLearningSession(`oral:${currentScenario.id}`, { draft: inputText, updatedAt: Date.now() }))
      .then((saved) => { if (alive) setDataError(saved ? '' : '草稿尚未保存，请保留此页面并检查存储空间。'); });
    return () => { alive = false; };
  }, [inputText, currentScenario.id]);
  useEffect(() => {
    const refresh = () => setCorrectionIds(new Set(StorageService.getOralCorrections().map((item) => item.id)));
    window.addEventListener('lingoflow:storage', refresh);
    return () => window.removeEventListener('lingoflow:storage', refresh);
  }, []);

  const saveCorrection = async (message) => {
    const correction = correctionFromFeedback(message.feedback, { id: message.id, scenarioId: currentScenario.id, now: message.timestamp || Date.now() });
    if (!correction) return;
    const latest = StorageService.getOralCorrections();
    if (latest.some((item) => item.id === correction.id)) { setShowCorrections(true); return; }
    const saved = await StorageService.saveOralCorrections([...latest, correction]);
    if (!saved) { toast.error('纠错句子尚未保存，可以保留此对话并点击这里重试。'); return; }
    setCorrectionIds(new Set(StorageService.getOralCorrections().map((item) => item.id)));
    toast.success('已加入隔日纠错句库');
  };

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Cancel an in-flight AI stream and release the microphone when leaving the page.
  // Previously neither was cleaned up, so switching tabs left the request running and
  // its result could be applied to an unmounted component.
  useEffect(() => () => {
    streamAbortRef.current?.abort();
    sendAfterRecognitionRef.current = false;
    stt.stop();
    tts.stop();
  }, []);

  // Save current scenario selection to settings
  const handleSelectScenario = (scenario) => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    sendAfterRecognitionRef.current = false;
    stt.stop();
    tts.stop();
    setCurrentScenario(scenario);
    setMessages(loadScenarioMessages(scenario));
    setInputText(StorageService.getLearningSession(`oral:${scenario.id}`).draft || '');
    setIsLoading(false);
    setIsRecording(false);
    setWantedWordsList(pickWantedWords());
    setActivatedWords({});
    const settings = StorageService.getSettings();
    settings.currentScenarioId = scenario.id;
    StorageService.saveSettings(settings);
  };

  // Jump straight to the scenario a saved word came from (source chip in the vocabulary list).
  useEffect(() => {
    if (!intent?.token) return;
    if (intent.practiceWords?.length) setWantedWordsList(intent.practiceWords.map((word) => StorageService.getVocabulary().find((entry) => entry.word.toLowerCase() === word.toLowerCase()) || { word }));
    if (!intent.scenarioId) return;
    const target = SCENARIOS.find((scenario) => scenario.id === intent.scenarioId);
    if (target) handleSelectScenario(target);
    // handleSelectScenario is recreated per render; the token keeps this a one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.token]);

  // Get active target words from vocabulary
  const getActiveTargetWords = () => {
    if (!practiceWithVocab) return [];
    if (wantedWordsList.length > 0) {
      return wantedWordsList.map((w) => w.word);
    }
    const words = StorageService.getVocabulary();
    return words.slice(0, 3).map((w) => w.word);
  };

  // Handle Send Message with streaming typewriter
  const handleSendMessage = async (textToSend, retryId) => {
    const text = (textToSend || inputText).trim();
    if (!text || isLoading || streamAbortRef.current) return;

    // Intercept missing API Key to prevent scary red error!
    const currentSettings = StorageService.getSettings();
    if (!currentSettings.apiKey?.trim()) {
      setShowQuickKeyModal(true);
      return;
    }

    const controller = new AbortController();
    streamAbortRef.current = controller;
    const scenario = currentScenario;
    const turn = prepareOralTurn(messagesRef.current, text, { retryId });
    const saved = await StorageService.saveChatMessages(scenario.id, turn.messages);
    if (!saved) {
      streamAbortRef.current = null;
      toast.error('消息未能保存，你的输入仍在。请检查存储空间后再试。');
      return;
    }
    if (controller.signal.aborted) { streamAbortRef.current = null; return; }
    messagesRef.current = turn.messages;
    setMessages(turn.messages);
    setIsLoading(true);
    if (!retryId) setInputText('');

    const targetWords = getActiveTargetWords();

    // Check if the user hit any target words (Wanted Words Mission).
    // This must run BEFORE the input is cleared and must never throw: `targetWords` comes
    // from the user's own vocabulary book, so an entry such as `C++` or a whole collected
    // sentence used to make `new RegExp` raise "Nothing to repeat" — the input had already
    // been emptied and nothing surfaced the error, so the message silently disappeared.
    const hitWords = retryId ? [] : targetWords.filter((word) => containsTerm(text, word));

    if (hitWords.length > 0) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#f59e0b', '#3b82f6', '#10b981', '#ec4899'],
      });

      setActivatedWords((prev) => {
        const next = { ...prev };
        hitWords.forEach((hw) => {
          next[hw.toLowerCase()] = true;
        });
        return next;
      });

      // Occurrence is evidence of use, not of correct recall: keep the SRS schedule intact.
      hitWords.forEach((word) => {
        const found = StorageService.getVocabulary().find((entry) => entry.word.toLowerCase() === word.toLowerCase());
        if (found) StorageService.updateWord(found.id, { lastUsedAt: Date.now(), useCount: (found.useCount || 0) + 1 });
      });

      setMissionToast(`已在对话中使用目标词：${hitWords.join(', ')}`);
      setTimeout(() => setMissionToast(null), 4000);
    }

    try {
      const targetWords = getActiveTargetWords();
      const aiResponse = await getOralCoachResponseStream({
        history: turn.history,
        userMessage: text,
        scenarioPrompt: scenario.prompt,
        targetWords,
        signal: controller.signal,
        onStreamText: (streamedText) => {
          if (controller.signal.aborted) return;
          const next = messagesRef.current.map((m) => m.id === turn.assistant.id ? { ...m, replyText: streamedText } : m);
          messagesRef.current = next;
          setMessages(next);
        },
      });
      // A cancelled request must not write its result into the conversation.
      if (controller.signal.aborted) return;

      const response = {
        replyText: aiResponse.replyText,
        replyTextCn: aiResponse.replyTextCn,
        feedback: aiResponse.feedback,
        suggestedReplies: aiResponse.suggestedReplies || [],
        isStreaming: false,
        timestamp: currentTimestamp(),
      };

      const finalMessages = finishOralTurn(messagesRef.current, turn.assistant.id, response);
      messagesRef.current = finalMessages;
      setMessages(finalMessages);
      const completedSaved = await StorageService.saveChatMessages(scenario.id, finalMessages);
      if (!completedSaved) { toast.error('回复已显示，但尚未保存。请先复制内容或检查存储空间。'); return; }
      StorageService.recordStudyActivity({ type: 'oral', count: 1, durationMinutes: studyClock.takeMinutes(), source: 'oral-chat', entityId: scenario.id, label: '完成一轮口语对练' });
      const correction = correctionFromFeedback(aiResponse.feedback, { id: turn.assistant.id, scenarioId: scenario.id });
      if (correction) {
        const corrections = StorageService.getOralCorrections();
        if (!corrections.some((item) => item.id === correction.id)) {
          const correctionSaved = await StorageService.saveOralCorrections([...corrections, correction]);
          if (!correctionSaved) toast.error('本轮纠错还未存入句库，请保留对话并稍后重试。');
        }
      }

      // Auto play audio if enabled
      const settings = StorageService.getSettings();
      if (settings.autoPlayOralAudio) {
        if (!controller.signal.aborted) playAudio(turn.assistant.id, aiResponse.replyText);
      }
    } catch (err) {
      if (controller.signal.reason === 'discard') return;
      const diag = controller.signal.aborted
        ? { title: '这轮回复已暂停', tip: '你的消息已保留，回来后可以原位重试。' }
        : diagnoseErrorMessage(err.message);
      const stored = StorageService.getChatMessages(scenario.id);
      const failed = failOralTurn(stored.length ? stored : turn.messages, turn.assistant.id, diag);
      const failureSaved = await StorageService.saveChatMessages(scenario.id, failed);
      if (!failureSaved && !controller.signal.aborted) toast.error('失败记录尚未保存，你的输入仍在当前对话里，请先保留或复制。');
      if (!controller.signal.aborted) { messagesRef.current = failed; setMessages(failed); }
    } finally {
      if (streamAbortRef.current === controller) { streamAbortRef.current = null; setIsLoading(false); }
    }
  };

  // Retry sending message after error
  const handleRetrySendMessage = (failedText, errorMsgId) => {
    if (!failedText || isLoading) return;
    handleSendMessage(failedText, errorMsgId);
  };

  // Voice Recording Toggle
  const toggleRecording = () => {
    if (isRecording) {
      stt.stop();
      setIsRecording(false);
    } else {
      if (!isSttSupported) {
        setMicHelpReason('unsupported');
        setShowMicHelp(true);
        return;
      }

      transcriptRef.current = '';
      sendAfterRecognitionRef.current = false;
      stt.startListening({
        onStart: () => setIsRecording(true),
        onResult: ({ text, isFinal }) => {
          transcriptRef.current = text;
          setInputText(text);
          if (isFinal) {
            setIsRecording(false);
          }
        },
        onError: (err) => {
          console.warn(err);
          sendAfterRecognitionRef.current = false;
          setIsRecording(false);
          const errorCode = err?.error || err?.name || '';
          setMicHelpReason(
            ['not-allowed', 'service-not-allowed', 'NotAllowedError'].includes(errorCode)
              ? 'permission'
              : errorCode === 'no-speech'
                ? 'no-speech'
                : 'unavailable'
          );
          setShowMicHelp(true);
        },
        onEnd: () => {
          setIsRecording(false);
          if (sendAfterRecognitionRef.current) {
            sendAfterRecognitionRef.current = false;
            if (transcriptRef.current.trim()) handleSendMessage(transcriptRef.current);
            else toast.info('没有识别到语音，请再说一次。');
          }
        },
      });
    }
  };

  // Play Audio with Web Speech TTS
  const playAudio = (msgId, text) => {
    if (isSpeakingId === msgId) {
      tts.stop();
      setIsSpeakingId(null);
      return;
    }

    setIsSpeakingId(msgId);
    tts.speak(text).finally(() => {
      setIsSpeakingId((current) => (current === msgId ? null : current));
    });
  };

  // Toggle Chinese Translation visibility
  const toggleTranslation = (id) => {
    setRevealedCnIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Clear Chat History
  const handleClearHistory = () => {
    if (confirm('确认清空当前情景的对话记录吗？')) {
      streamAbortRef.current?.abort('discard');
      streamAbortRef.current = null;
      setIsLoading(false);
      StorageService.clearChatMessages(currentScenario.id);
      const initial = [
        {
          id: `init_${currentScenario.id}`,
          role: 'assistant',
          replyText: currentScenario.initialMessage,
          replyTextCn: currentScenario.initialMessageCn,
          timestamp: Date.now(),
        },
      ];
      setMessages(initial);
      StorageService.saveChatMessages(currentScenario.id, initial);
    }
  };

  // Quick add expression to vocabulary
  const handleAddExpressionToVocab = (wordOrPhrase, contextSentence, translation) => {
    const saved = StorageService.addWord({
      word: wordOrPhrase,
      translation: translation || '口语地道表达',
      contextSentence: contextSentence,
      contextSentenceCn: translation || '',
      pos: wordOrPhrase.includes(' ') ? 'phrase' : 'expression',
      tags: ['口语实战', currentScenario.name],
      sources: [{ type: 'oral', id: currentScenario.id, key: `oral:${currentScenario.id}`, label: currentScenario.name }],
    });
    if (!saved) { toast.error('表达尚未保存，请检查存储空间后重试。'); return; }
    setAddedWordFeedback((prev) => ({ ...prev, [wordOrPhrase]: true }));
    setTimeout(() => {
      setAddedWordFeedback((prev) => ({ ...prev, [wordOrPhrase]: false }));
    }, 4000);
  };

  return (
    <div className="study-page oral-page flex flex-col h-full min-h-0">
      <header className="oral-compact-header flex-none flex items-center justify-between gap-3 border-b border-stone-200 bg-[#fffdf8] px-4 py-2.5" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}>
        <span className="oral-avatar" aria-hidden="true">{currentScenario.icon}</span><div className="min-w-0 flex-1"><h1 className="truncate text-base font-bold text-[#102a43]">{currentScenario.name}</h1><p className="mt-1 text-[11px] text-slate-500"><span className="oral-status-dot" />{!hasApiKey ? '配置 AI 后，开始聊天' : practiceWithVocab && wantedWordsList.length ? `目标词 ${wantedWordsList.filter((item) => activatedWords[item.word.toLowerCase()]).length}/${wantedWordsList.length} · 用英语聊一聊` : '随时可以开始聊天'}</p></div>
        <button type="button" onClick={() => onNavigate('dictionary')} aria-label="打开词典" className="rounded-xl bg-white p-2.5 text-sky-700"><Search size={18} /></button>
        <button type="button" onClick={() => setShowCorrections(true)} className="rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">纠错复习</button>
        <button type="button" onClick={() => setShowPracticeOptions(true)} aria-haspopup="dialog" className="shrink-0 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">场景</button>
      </header>
      <BottomSheet open={showPracticeOptions} onClose={() => setShowPracticeOptions(false)} title="口语练习设置" bodyClassName="!p-0" footer={<button type="button" onClick={() => setShowPracticeOptions(false)} className="w-full rounded-xl bg-[#102a43] py-3 text-sm font-semibold text-white">返回对话</button>}>
      <StudyHeader
        eyebrow="SPEAK · ACTIVE ENGLISH"
        title={currentScenario.name}
        description={`${currentScenario.desc} · 让今天记住的词真正说出口。`}
        icon={<span className="text-base">{currentScenario.icon}</span>}
        status={hasApiKey ? 'Key 已配置' : '待配置 Key'}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setPracticeWithVocab(!practiceWithVocab)}
              aria-pressed={practiceWithVocab}
              title="联动生词本：在对话中强化记忆今日生词"
              className={`tap-lift flex items-center gap-1 rounded-xl border px-2.5 py-2 text-[11px] font-semibold transition-all ${
                practiceWithVocab
                  ? 'border-amber-300 bg-amber-400 text-[#102a43]'
                  : 'border-white/15 bg-white/10 text-slate-200'
              }`}
            >
              <Flame className={`w-3.5 h-3.5 ${practiceWithVocab ? 'fill-current' : ''}`} />
              <span>{practiceWithVocab ? '生词联动中' : '联动生词'}</span>
            </button>
            <button
              type="button"
              onClick={handleClearHistory}
              title="重置当前对话"
              className="tap-lift rounded-xl border border-white/15 bg-white/10 p-2 text-slate-200 hover:bg-white/15"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </>
        )}
      >
        <div className="grid grid-cols-2 gap-2 text-xs" aria-label="口语练习场景">
          {SCENARIOS.map((sc) => {
            const isActive = sc.id === currentScenario.id;
            return (
              <button
                type="button"
                key={sc.id}
                onClick={() => { handleSelectScenario(sc); setShowPracticeOptions(false); }}
                aria-pressed={isActive}
                className="study-pill tap-lift flex-none flex items-center space-x-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-all"
              >
                <span>{sc.icon}</span>
                <span>{sc.name}</span>
              </button>
            );
          })}
        </div>

        {practiceWithVocab && wantedWordsList.length > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-white/5 p-2 text-xs ring-1 ring-white/10">
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-300 flex-none mr-2">
              <Target className="w-3.5 h-3.5" />
              <span>本轮目标</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1">
              {wantedWordsList.map((item) => {
                const isHit = activatedWords[item.word.toLowerCase()];
                return (
                  <button
                    key={item.id || item.word}
                    onClick={() => tts.speak(item.word)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 flex-none transition-all active:scale-95 ${
                      isHit
                        ? 'bg-emerald-500 text-white border-emerald-400 font-bold'
                        : 'bg-white/10 text-amber-100 border-white/15 hover:bg-white/15'
                    }`}
                    title={`点击听发音：${item.translation || ''}`}
                  >
                    <span>{isHit ? '🔥 已激活' : '🎯'}</span>
                    <span className="font-mono">{item.word}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={refreshWantedWords}
              className="flex-none ml-1.5 p-1 text-slate-300 hover:text-amber-300 rounded-md text-[10.5px] transition-colors flex items-center gap-0.5"
              title="随机换一批通缉生词挑战"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">换一批</span>
            </button>
          </div>
        )}
      </StudyHeader>
      </BottomSheet>

      {/* Floating Mission Success Toast */}
      {missionToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5 animate-bounce">
          <Trophy className="w-4 h-4 text-amber-200" />
          <span>{missionToast}</span>
        </div>
      )}

      {/* Chat Messages List */}
      <div className="oral-chat flex-1 min-h-0 overflow-y-auto p-4 space-y-4" aria-label="口语对话记录">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isSpeaking = isSpeakingId === msg.id;
          const showCn = revealedCnIds[msg.id];

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[86%] rounded-3xl p-4 shadow-sm relative transition-all ${
                  isUser
                    ? 'bg-gradient-to-br from-sky-600 to-blue-600 text-white rounded-br-xs shadow-[0_4px_16px_-2px_rgba(2,132,199,0.3)]'
                    : msg.isError
                    ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-bl-xs'
                    : 'glass-panel text-slate-850 rounded-bl-xs shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] border border-white/90'
                }`}
              >
                {/* Text Content */}
                <p className="text-[15px] leading-relaxed select-text font-normal">
                  {isUser ? (
                    msg.text
                  ) : (
                    <>
                      {msg.replyText || (msg.isStreaming ? '...' : '')}
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-3.5 bg-sky-500 rounded-xs animate-pulse ml-1 align-middle" />
                      )}
                    </>
                  )}
                </p>

                {/* AI Error Recovery Box */}
                {!isUser && msg.isError && (
                  <div className="mt-2.5 p-3 bg-rose-50/90 rounded-2xl border border-rose-200/80 text-xs text-rose-900 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-rose-800">
                      <AlertCircle className="w-4 h-4 text-rose-600 flex-none" />
                      <span>{msg.errorTitle || '对话未能送达'}</span>
                    </div>
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      {msg.replyTextCn || '可能是网络暂时波动，您的输入已妥善留存。'}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      {msg.failedUserText && (
                        <button
                          onClick={() => handleRetrySendMessage(msg.failedUserText, msg.id)}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs active:scale-95 flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>一键重试此句</span>
                        </button>
                      )}
                      {msg.failedUserText && (
                        <button
                          onClick={() => setInputText(msg.failedUserText)}
                          className="px-2.5 py-1.5 bg-white hover:bg-rose-100/60 text-rose-700 rounded-xl text-xs font-medium border border-rose-200 shadow-2xs"
                        >
                          填回输入框
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* AI Auxiliary Controls (TTS & Translate) */}
                {!isUser && !msg.isError && !msg.isStreaming && (
                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => playAudio(msg.id, msg.replyText)}
                        className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg transition-colors ${
                          isSpeaking
                            ? 'bg-sky-100 text-sky-700 font-semibold animate-pulse'
                            : 'hover:bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isSpeaking ? (
                          <>
                            <VolumeX className="w-3.5 h-3.5" />
                            <span>停止</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5" />
                            <span>朗读</span>
                          </>
                        )}
                      </button>

                      {msg.replyTextCn && (
                        <button
                          onClick={() => toggleTranslation(msg.id)}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
                        >
                          <Languages className="w-3.5 h-3.5" />
                          <span>{showCn ? '收起中文' : '看中文'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Collapsible Chinese Translation */}
                {!isUser && showCn && msg.replyTextCn && (
                  <div className="mt-2.5 p-2.5 bg-slate-50/90 rounded-xl text-xs text-slate-700 leading-relaxed border border-slate-200/60 select-text">
                    {msg.replyTextCn}
                  </div>
                )}
              </div>

              {/* Dual-Track Feedback: Grammar Correction & Idiomatic Alternative */}
              {!isUser && msg.feedback?.hasSlip && (
                <div className="max-w-[86%] mt-2.5 bg-gradient-to-br from-amber-50/95 via-orange-50/80 to-amber-50/90 border border-amber-200/80 rounded-2xl p-3.5 shadow-sm text-xs text-amber-950">
                  <div className="flex items-center justify-between font-bold text-amber-900 mb-2">
                    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-800">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      外教纠错与地道表达升级
                    </span>
                  </div>

                  {msg.feedback.userOriginal && msg.feedback.corrected && <button type="button" onClick={() => saveCorrection(msg)} className="mb-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-amber-900">{correctionIds.has(`correction_${msg.id}`) ? '已入隔日句库 · 查看' : '加入隔日纠错复习'}</button>}

                  {/* Original slip vs Corrected */}
                  {msg.feedback.userOriginal && (
                    <div className="space-y-1.5 mb-2.5 bg-white/80 p-2.5 rounded-xl border border-amber-100 shadow-2xs">
                      <div className="flex items-start gap-1.5 text-slate-500 line-through">
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">原句</span>
                        <span className="select-text">{msg.feedback.userOriginal}</span>
                      </div>
                      <div className="flex items-start gap-1.5 text-emerald-800 font-semibold">
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">更正</span>
                        <span className="select-text">{msg.feedback.corrected}</span>
                      </div>
                    </div>
                  )}

                  {/* Explanation in Chinese */}
                  {msg.feedback.explanationZh && (
                    <p className="text-slate-700 leading-relaxed mb-2.5 pl-0.5">
                      💡 {msg.feedback.explanationZh}
                    </p>
                  )}

                  {/* Native / Advanced alternative with 1-click Add to Vocab */}
                  {msg.feedback.betterAlternative && (
                    <div className="flex items-center justify-between pt-2 border-t border-amber-200/60 mt-1">
                      <div className="flex-1 pr-2">
                        <span className="text-[10px] text-amber-800 block font-semibold">✨ 外教级地道说法:</span>
                        <span className="text-amber-950 font-bold select-text font-serif text-[13px]">
                          "{msg.feedback.betterAlternative}"
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-none">
                        <button
                          onClick={() =>
                            handleAddExpressionToVocab(
                              msg.feedback.betterAlternative,
                              msg.feedback.corrected || msg.feedback.betterAlternative,
                              msg.feedback.explanationZh
                            )
                          }
                          className="flex items-center gap-1 bg-amber-200/80 hover:bg-amber-300 text-amber-950 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors shadow-2xs active:scale-95"
                        >
                          {addedWordFeedback[msg.feedback.betterAlternative] ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>已收藏</span>
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="w-3.5 h-3.5 text-amber-800" />
                              <span>存入生词本</span>
                            </>
                          )}
                        </button>
                        {addedWordFeedback[msg.feedback.betterAlternative] && onNavigateToVocab && (
                          <button
                            onClick={onNavigateToVocab}
                            className="flex items-center gap-0.5 bg-sky-100 hover:bg-sky-200 text-sky-800 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-colors shadow-2xs"
                            title="前往生词本查看刚收藏的卡片"
                          >
                            <span>去生词本 →</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quick Suggested Reply Pills */}
              {!isUser && msg.suggestedReplies && msg.suggestedReplies.length > 0 && (
                <div className="max-w-[86%] mt-2 flex flex-wrap gap-1.5">
                  {msg.suggestedReplies.map((reply) => (
                    <button
                      key={reply}
                      onClick={() => handleSendMessage(reply)}
                      className="text-left text-xs bg-sky-50/80 hover:bg-sky-100 text-sky-800 border border-sky-200/60 px-2.5 py-1 rounded-full transition-all flex items-center gap-1"
                    >
                      <span>💬 {reply}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Loading Indicator for first chunk */}
        {isLoading && !messages.some((m) => m.isStreaming && m.replyText) && (
          <div className="flex items-center space-x-2 text-slate-500 text-xs py-1 px-1">
            <div className="flex space-x-1">
              <span className="w-1.5 h-1.5 bg-sky-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-sky-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-sky-500 rounded-full animate-bounce"></span>
            </div>
            <span>外教 Echo 正在即时对话中...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar: Audio Button & Text Box */}
      <footer className="flex-none glass-floating-bar border-t border-white/80 p-3 pb-safe z-20">
        {dataError && <output className="mb-2 block text-xs text-rose-700">{dataError}</output>}
        {/* Newbie Onboarding Banner when no key is set */}
        {!hasApiKey && (
          <button type="button" onClick={() => setShowQuickKeyModal(true)} className="mb-2 flex w-full items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800"><span>配置 AI 后即可对练</span><span className="font-semibold">去配置 →</span></button>
        )}

        {isRecording && (
          <div className="mb-2 px-3.5 py-2 bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200/80 rounded-2xl flex items-center justify-between text-xs text-rose-800 shadow-xs animate-pulse">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
              <span className="font-medium">正在聆听... 说完点右侧立即发送</span>
            </div>
            <button
              onClick={() => {
                sendAfterRecognitionRef.current = true;
                stt.stop();
              }}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold px-3 py-1.5 rounded-xl text-[11px] hover:from-emerald-700 hover:to-teal-700 transition-all shadow-xs active:scale-95"
            >
              🚀 说完，立即发送
            </button>
          </div>
        )}

        <div className="flex items-end space-x-2">
          {/* Mic Button */}
          <button
            type="button"
            onClick={toggleRecording}
            className={`p-3 rounded-2xl flex-none transition-all active:scale-90 ${
              isRecording
                ? 'bg-gradient-to-br from-rose-500 to-pink-600 text-white ring-4 ring-rose-200/70 shadow-md scale-105'
                : 'bg-white/90 hover:bg-white text-slate-700 shadow-xs border border-slate-200/80'
            }`}
            title="点击开始/停止英语语音识别"
            aria-label={isRecording ? '停止语音识别' : '开始语音识别'}
          >
            {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-sky-600" />}
          </button>

          {/* Text Input */}
          <div className="flex-1 bg-white/90 rounded-2xl flex items-center px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-sky-500/30 focus-within:bg-white border border-slate-200/80 focus-within:border-sky-400 transition-all shadow-xs">
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing && !e.isComposing) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="用英语回复或点麦克风说话..."
              aria-label="输入英语回复"
              className="w-full bg-transparent resize-none outline-hidden text-sm text-slate-800 placeholder-slate-400 max-h-24 py-1.5"
            />
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            aria-label="发送英语回复"
            className={`p-3 rounded-2xl flex-none transition-all active:scale-90 ${
              inputText.trim() && !isLoading
                ? 'bg-gradient-to-br from-sky-600 to-blue-600 text-white shadow-md hover:from-sky-700 hover:to-blue-700'
                : 'bg-slate-200/80 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>
      {showCorrections && <OralCorrections open onClose={() => setShowCorrections(false)} onPractice={(item) => { setInputText(item.corrected); setShowCorrections(false); }} />}

      {/* Gentle Microphone Help Sheet */}
      <BottomSheet
        open={showMicHelp}
        title="语音输入帮助"
        onClose={() => setShowMicHelp(false)}
        size="sm"
        showCloseButton={false}
        className="sm:rounded-3xl"
        bodyClassName="p-5"
      >
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-start justify-between">
              <div className="flex gap-3">
                <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-100 to-indigo-100 flex items-center justify-center shadow-inner">
                  <Mic className="w-5 h-5 text-sky-700" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {micHelpReason === 'permission'
                      ? '还差一步：允许使用麦克风'
                      : micHelpReason === 'no-speech'
                        ? '刚才没有听清，再试一次吧'
                        : '这个浏览器暂未开放语音识别'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">不用担心，文字对练仍然可以正常使用</p>
                </div>
              </div>
              <button
                onClick={() => setShowMicHelp(false)}
                className="p-1 text-slate-400 hover:bg-slate-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {micHelpReason === 'permission' ? (
              <div className="mt-4 p-3.5 rounded-2xl bg-sky-50/80 border border-sky-100 space-y-2.5 text-xs text-slate-700">
                <p className="font-bold text-sky-900">iPhone Safari 开启方法</p>
                <p><strong>1.</strong> 点地址栏左侧的“大小”或页面菜单</p>
                <p><strong>2.</strong> 进入“网站设置” → “麦克风”</p>
                <p><strong>3.</strong> 选择“允许”，刷新页面后再点话筒</p>
              </div>
            ) : (
              <div className="mt-4 p-3.5 rounded-2xl bg-amber-50/80 border border-amber-100 text-xs text-slate-700 leading-relaxed">
                <p className="font-bold text-amber-900 mb-1.5">最稳妥的替代方法</p>
                <p>轻触下方文字输入框，再点手机键盘自带的 🎙️ 语音输入键。说完后，文字会自动出现在输入框里，然后点击发送即可。</p>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowMicHelp(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                改用键盘输入
              </button>
              {isSttSupported && (
                <button
                  onClick={() => {
                    setShowMicHelp(false);
                    setTimeout(() => toggleRecording(), 150);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 text-white text-xs font-bold shadow-xs active:scale-95"
                >
                  再试一次麦克风
                </button>
              )}
            </div>
      </BottomSheet>

      {/* Quick API Key Modal */}
      <Modal
        open={showQuickKeyModal}
        title="配置口语 AI"
        onClose={() => setShowQuickKeyModal(false)}
        size="sm"
        showCloseButton={false}
        bodyClassName="space-y-3.5 p-5"
      >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-sky-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  填入 AI 密钥开启外教伴读
                </h3>
              </div>
              <button
                onClick={() => setShowQuickKeyModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              LingoFlow 不自建服务器保存对话；聊天内容会直接发送给你选择的 AI 服务商处理。建议不要输入密码、证件号等敏感信息。
            </p>

            <div>
              <label htmlFor="oral-quick-key" className="block text-xs font-semibold text-slate-700 mb-1">
                DeepSeek API Key (sk-...)
              </label>
              <input
                id="oral-quick-key"
                type="password"
                value={quickKeyInput}
                onChange={(e) => setQuickKeyInput(e.target.value)}
                placeholder="在此粘贴你的 sk- 开头密钥"
                className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
              />
              <div className="flex justify-between items-center mt-1 text-[11px]">
                <span className="text-slate-400">密钥仅保存在本地手机中</span>
                <a
                  href="https://platform.deepseek.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-600 hover:underline flex items-center gap-0.5 font-medium"
                >
                  <span>获取免费 Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowQuickKeyModal(false)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                先逛逛
              </button>
              <button
                onClick={() => {
                  const key = quickKeyInput.trim();
                  if (!key) {
                    toast.error('请先输入有效的 API Key');
                    return;
                  }
                  const settings = StorageService.getSettings();
                  settings.apiKey = key;
                  if (!StorageService.saveSettings(settings)) { toast.error('密钥未能保存，请检查存储空间。'); return; }
                  setHasApiKey(true);
                  setShowQuickKeyModal(false);
                  toast.success('🎉 配置成功！现在可以畅快与外教 Echo 对练啦！');
                }}
                className="flex-1 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              >
                保存并开始聊天
              </button>
            </div>
      </Modal>
    </div>
  );
}
