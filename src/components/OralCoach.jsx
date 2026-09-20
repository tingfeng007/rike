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
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SCENARIOS } from '../data/scenarios';
import { StorageService } from '../services/storage';
import { getOralCoachResponseStream } from '../services/ai';
import { tts, stt } from '../services/speech';

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

export default function OralCoach({ onNavigateToVocab }) {
  const [scenarios] = useState(SCENARIOS);
  const [currentScenario, setCurrentScenario] = useState(() => {
    const saved = StorageService.getSettings().currentScenarioId;
    return SCENARIOS.find((s) => s.id === saved) || SCENARIOS[0];
  });

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeakingId, setIsSpeakingId] = useState(null);
  const [revealedCnIds, setRevealedCnIds] = useState({});
  const [practiceWithVocab, setPracticeWithVocab] = useState(true);
  const [addedWordFeedback, setAddedWordFeedback] = useState({});
  const [activatedWords, setActivatedWords] = useState({});
  const [missionToast, setMissionToast] = useState(null);
  const [wantedWordsList, setWantedWordsList] = useState([]);
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(StorageService.getSettings().apiKey?.trim()));
  const [showQuickKeyModal, setShowQuickKeyModal] = useState(false);
  const [quickKeyInput, setQuickKeyInput] = useState('');
  const [showMicHelp, setShowMicHelp] = useState(false);
  const [micHelpReason, setMicHelpReason] = useState('unsupported');

  // Randomly refresh wanted words
  const refreshWantedWords = () => {
    const words = StorageService.getVocabulary();
    const unmastered = words.filter((w) => w.status !== 'mastered');
    const pool = unmastered.length >= 3 ? unmastered : words;
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    setWantedWordsList(shuffled.slice(0, 3));
  };

  useEffect(() => {
    refreshWantedWords();
  }, [currentScenario.id]);

  const messagesEndRef = useRef(null);
  const isSttSupported = stt.isSupported();

  // Load chat history for current scenario
  useEffect(() => {
    const history = StorageService.getChatMessages(currentScenario.id);
    if (history.length === 0) {
      // Setup initial welcome greeting from AI
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
    } else {
      setMessages(history);
    }
  }, [currentScenario.id]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Save current scenario selection to settings
  const handleSelectScenario = (scenario) => {
    setCurrentScenario(scenario);
    const settings = StorageService.getSettings();
    settings.currentScenarioId = scenario.id;
    StorageService.saveSettings(settings);
  };

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
  const handleSendMessage = async (textToSend) => {
    const text = (textToSend || inputText).trim();
    if (!text || isLoading) return;

    // Intercept missing API Key to prevent scary red error!
    const currentSettings = StorageService.getSettings();
    if (!currentSettings.apiKey?.trim()) {
      setShowQuickKeyModal(true);
      return;
    }

    setInputText('');

    const targetWords = getActiveTargetWords();

    // Check if user hit any target words! (Wanted Words Mission)
    const hitWords = targetWords.filter((w) =>
      new RegExp(`\\b${w}\\b`, 'i').test(text)
    );

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

      // Boost word in vocabulary
      hitWords.forEach((hw) => {
        const allWords = StorageService.getVocabulary();
        const found = allWords.find((v) => v.word.toLowerCase() === hw.toLowerCase());
        if (found) {
          StorageService.updateWordSRS(found.id, 'good');
          const reloaded = StorageService.getVocabulary();
          const tIdx = reloaded.findIndex((v) => v.id === found.id);
          if (tIdx >= 0) {
            const tags = reloaded[tIdx].tags || [];
            if (!tags.includes('🔥 实战激活')) {
              reloaded[tIdx].tags = ['🔥 实战激活', ...tags];
              StorageService.saveVocabulary(reloaded);
            }
          }
        }
      });

      setMissionToast(`🎯 恭喜！成功在对话中实战激活生词 [${hitWords.join(', ')}]！掌握度升级！`);
      setTimeout(() => setMissionToast(null), 4000);
    }

    const now = Date.now();
    const userMsg = {
      id: `usr_${now}`,
      role: 'user',
      text: text,
      timestamp: now,
    };

    const tempAiId = `ai_${now + 1}`;
    const tempAiMsg = {
      id: tempAiId,
      role: 'assistant',
      replyText: '',
      isStreaming: true,
      timestamp: now + 1,
    };

    const messagesWithUser = [...messages, userMsg];
    const messagesWithStreaming = [...messagesWithUser, tempAiMsg];

    setMessages(messagesWithStreaming);
    setIsLoading(true);

    try {
      const targetWords = getActiveTargetWords();
      const aiResponse = await getOralCoachResponseStream({
        history: messagesWithUser,
        userMessage: text,
        scenarioPrompt: currentScenario.prompt,
        targetWords,
        onStreamText: (streamedText) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAiId ? { ...m, replyText: streamedText } : m
            )
          );
        },
      });

      const finalAssistantMsg = {
        id: tempAiId,
        role: 'assistant',
        replyText: aiResponse.replyText,
        replyTextCn: aiResponse.replyTextCn,
        feedback: aiResponse.feedback,
        suggestedReplies: aiResponse.suggestedReplies || [],
        isStreaming: false,
        timestamp: Date.now(),
      };

      const finalMessages = [...messagesWithUser, finalAssistantMsg];
      setMessages(finalMessages);
      StorageService.saveChatMessages(currentScenario.id, finalMessages);
      StorageService.recordStudyActivity({ type: 'oral', count: 1 });

      // Auto play audio if enabled
      const settings = StorageService.getSettings();
      if (settings.autoPlayOralAudio) {
        playAudio(finalAssistantMsg.id, finalAssistantMsg.replyText);
      }
    } catch (err) {
      console.error(err);
      const diag = diagnoseErrorMessage(err.message);
      const errorMsg = {
        id: tempAiId,
        role: 'assistant',
        replyText: `Oops! ${err.message}`,
        errorTitle: diag.title,
        replyTextCn: diag.tip,
        failedUserText: text,
        isError: true,
        isStreaming: false,
        timestamp: Date.now(),
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === tempAiId ? errorMsg : m))
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Retry sending message after error
  const handleRetrySendMessage = (failedText, errorMsgId) => {
    if (!failedText || isLoading) return;
    // Remove the error assistant bubble
    setMessages((prev) => prev.filter((m) => m.id !== errorMsgId));
    handleSendMessage(failedText);
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

      stt.startListening({
        onStart: () => setIsRecording(true),
        onResult: ({ text, isFinal }) => {
          setInputText(text);
          if (isFinal) {
            setIsRecording(false);
          }
        },
        onError: (err) => {
          console.warn(err);
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
        onEnd: () => setIsRecording(false),
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
    StorageService.addWord({
      word: wordOrPhrase,
      translation: translation || '口语地道表达',
      contextSentence: contextSentence,
      contextSentenceCn: translation || '',
      pos: wordOrPhrase.includes(' ') ? 'phrase' : 'expression',
      tags: ['口语实战', currentScenario.name],
    });
    setAddedWordFeedback((prev) => ({ ...prev, [wordOrPhrase]: true }));
    setTimeout(() => {
      setAddedWordFeedback((prev) => ({ ...prev, [wordOrPhrase]: false }));
    }, 4000);
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Top Header: Scenario Selector & Actions */}
      <header 
        className="flex-none glass-panel border-b border-white/80 px-4 py-2.5 shadow-xs z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="text-2xl drop-shadow-xs">{currentScenario.icon}</span>
            <div>
              <h2 className="font-bold text-slate-900 text-sm leading-tight flex items-center gap-1.5">
                {currentScenario.name}
                <span className="text-[10px] font-semibold text-sky-700 bg-sky-100/80 px-2 py-0.5 rounded-full ring-1 ring-sky-200/60">
                  AI 外教 Echo
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 truncate max-w-[210px] mt-0.5">
                {currentScenario.desc}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setPracticeWithVocab(!practiceWithVocab)}
              title="联动生词本：在对话中强化记忆今日生词"
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full transition-all border ${
                practiceWithVocab
                  ? 'bg-amber-100/80 text-amber-900 border-amber-300 font-semibold shadow-xs ring-1 ring-amber-200'
                  : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-white'
              }`}
            >
              <Flame className={`w-3.5 h-3.5 ${practiceWithVocab ? 'text-amber-600 fill-amber-500' : 'text-slate-400'}`} />
              <span>生词联动</span>
            </button>

            <button
              onClick={handleClearHistory}
              title="重置当前对话"
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-full transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scenario Pills Scroll */}
        <div className="flex space-x-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          {scenarios.map((sc) => {
            const isActive = sc.id === currentScenario.id;
            return (
              <button
                key={sc.id}
                onClick={() => handleSelectScenario(sc)}
                className={`flex-none flex items-center space-x-1.5 px-3 py-1 rounded-full border transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white border-transparent shadow-sm font-semibold'
                    : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-white'
                }`}
              >
                <span>{sc.icon}</span>
                <span>{sc.name}</span>
              </button>
            );
          })}
        </div>

        {/* Wanted Words Mission Banner with Shuffle */}
        {practiceWithVocab && wantedWordsList.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-900 flex-none mr-2">
              <Target className="w-3.5 h-3.5 text-amber-600" />
              <span>生词通缉令：</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1">
              {wantedWordsList.map((item) => {
                const isHit = activatedWords[item.word.toLowerCase()];
                return (
                  <button
                    key={item.id}
                    onClick={() => tts.speak(item.word)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 flex-none transition-all active:scale-95 ${
                      isHit
                        ? 'bg-emerald-500 text-white border-emerald-600 font-bold shadow-xs'
                        : 'bg-amber-50/90 text-amber-900 border-amber-300/80 hover:bg-amber-100'
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
              className="flex-none ml-1.5 p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100/60 rounded-md text-[10.5px] transition-colors flex items-center gap-0.5"
              title="随机换一批通缉生词挑战"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">换一批</span>
            </button>
          </div>
        )}
      </header>

      {/* Floating Mission Success Toast */}
      {missionToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5 animate-bounce">
          <Trophy className="w-4 h-4 text-amber-200" />
          <span>{missionToast}</span>
        </div>
      )}

      {/* Chat Messages List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  {msg.suggestedReplies.map((reply, i) => (
                    <button
                      key={i}
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
        {/* Newbie Onboarding Banner when no key is set */}
        {!hasApiKey && (
          <div className="mb-2.5 p-2.5 bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200/80 rounded-2xl flex items-center justify-between shadow-2xs animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="text-lg">👋</span>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">欢迎来到 LingoFlow！开启你的专属外教</h4>
                <p className="text-[10.5px] text-slate-500">API Key 与历史记录保存在本机；消息由你选择的 AI 服务商处理</p>
              </div>
            </div>
            <button
              onClick={() => setShowQuickKeyModal(true)}
              className="px-2.5 py-1 bg-gradient-to-r from-sky-600 to-blue-600 text-white text-[11px] font-bold rounded-xl shadow-xs active:scale-95 flex-none"
            >
              一键开启
            </button>
          </div>
        )}

        {isRecording && (
          <div className="mb-2 px-3.5 py-2 bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200/80 rounded-2xl flex items-center justify-between text-xs text-rose-800 shadow-xs animate-pulse">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
              <span className="font-medium">正在聆听... 说完点右侧立即发送</span>
            </div>
            <button
              onClick={() => {
                toggleRecording();
                setTimeout(() => handleSendMessage(), 200);
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
              className="w-full bg-transparent resize-none outline-hidden text-sm text-slate-800 placeholder-slate-400 max-h-24 py-1.5"
            />
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
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

      {/* Gentle Microphone Help Sheet */}
      {showMicHelp && (
        <div onClick={() => setShowMicHelp(false)} className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150 cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white cursor-default w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-100">
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
          </div>
        </div>
      )}

      {/* Quick API Key Modal */}
      {showQuickKeyModal && (
        <div onClick={() => setShowQuickKeyModal(false)} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white cursor-default w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-3.5">
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                DeepSeek API Key (sk-...)
              </label>
              <input
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
                    alert('请先输入有效的 API Key');
                    return;
                  }
                  const settings = StorageService.getSettings();
                  settings.apiKey = key;
                  StorageService.saveSettings(settings);
                  setHasApiKey(true);
                  setShowQuickKeyModal(false);
                  alert('🎉 配置成功！现在可以畅快与外教 Echo 对练啦！');
                }}
                className="flex-1 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              >
                保存并开始聊天
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
