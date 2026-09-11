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
} from 'lucide-react';
import { SCENARIOS } from '../data/scenarios';
import { StorageService } from '../services/storage';
import { getOralCoachResponseStream } from '../services/ai';
import { tts, stt } from '../services/speech';

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
    const words = StorageService.getVocabulary();
    return words.slice(0, 3).map((w) => w.word);
  };

  // Handle Send Message with streaming typewriter
  const handleSendMessage = async (textToSend) => {
    const text = (textToSend || inputText).trim();
    if (!text || isLoading) return;

    setInputText('');

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

      // Auto play audio if enabled
      const settings = StorageService.getSettings();
      if (settings.autoPlayOralAudio) {
        playAudio(finalAssistantMsg.id, finalAssistantMsg.replyText);
      }
    } catch (err) {
      console.error(err);
      const errorMsg = {
        id: tempAiId,
        role: 'assistant',
        replyText: `Oops! ${err.message}`,
        replyTextCn: '请求出现错误，请检查设置中的 API Key 或网络状况。',
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

  // Voice Recording Toggle
  const toggleRecording = () => {
    if (isRecording) {
      stt.stop();
      setIsRecording(false);
    } else {
      if (!isSttSupported) {
        alert('当前浏览器未开放原生麦克风识别，建议直接使用输入法键盘自带的语音输入键（按空格或话筒图标）。');
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
    <div className="flex flex-col h-full bg-slate-50">
      {/* Top Header: Scenario Selector & Actions */}
      <header 
        className="flex-none bg-white border-b border-slate-200 px-4 py-2.5 shadow-xs"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
      >
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">{currentScenario.icon}</span>
            <div>
              <h2 className="font-semibold text-slate-800 text-sm leading-tight flex items-center gap-1.5">
                {currentScenario.name}
                <span className="text-xs font-normal text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full">
                  Oral Coach
                </span>
              </h2>
              <p className="text-xs text-slate-600 truncate max-w-[200px]">
                {currentScenario.desc}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => setPracticeWithVocab(!practiceWithVocab)}
              title="联动生词本：在对话中强化记忆今日生词"
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full transition-all border ${
                practiceWithVocab
                  ? 'bg-amber-50 text-amber-800 border-amber-300 font-medium'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              <Flame className={`w-3.5 h-3.5 ${practiceWithVocab ? 'text-amber-600 fill-amber-500' : 'text-slate-500'}`} />
              <span>生词联动</span>
            </button>

            <button
              onClick={handleClearHistory}
              title="重置当前对话"
              className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-colors"
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
                className={`flex-none flex items-center space-x-1 px-3 py-1 rounded-full border transition-all ${
                  isActive
                    ? 'bg-sky-600 text-white border-sky-600 shadow-xs font-medium'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{sc.icon}</span>
                <span>{sc.name}</span>
              </button>
            );
          })}
        </div>
      </header>

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
                className={`max-w-[86%] rounded-2xl p-3.5 shadow-xs relative transition-all ${
                  isUser
                    ? 'bg-sky-600 text-white rounded-br-xs'
                    : msg.isError
                    ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-bl-xs'
                    : 'bg-white border border-slate-200/80 text-slate-800 rounded-bl-xs'
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

                {/* AI Auxiliary Controls (TTS & Translate) */}
                {!isUser && !msg.isError && !msg.isStreaming && (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => playAudio(msg.id, msg.replyText)}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-md transition-colors ${
                          isSpeaking
                            ? 'bg-sky-100 text-sky-700 font-medium animate-pulse'
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
                          className="flex items-center space-x-1 px-2 py-0.5 rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
                        >
                          <Languages className="w-3.5 h-3.5" />
                          <span>{showCn ? '隐藏中文' : '中文大意'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Collapsible Chinese Translation */}
                {!isUser && showCn && msg.replyTextCn && (
                  <div className="mt-2 p-2 bg-slate-50 rounded-lg text-xs text-slate-700 leading-relaxed border border-slate-100 select-text">
                    {msg.replyTextCn}
                  </div>
                )}
              </div>

              {/* Dual-Track Feedback: Grammar Correction & Idiomatic Alternative */}
              {!isUser && msg.feedback?.hasSlip && (
                <div className="max-w-[86%] mt-2 bg-gradient-to-br from-amber-50 to-orange-50/50 border border-amber-200/80 rounded-xl p-3 shadow-xs text-xs text-amber-950">
                  <div className="flex items-center justify-between font-medium text-amber-850 mb-1.5">
                    <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-amber-700 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      口语纠错与地道表达升级
                    </span>
                  </div>

                  {/* Original slip vs Corrected */}
                  {msg.feedback.userOriginal && (
                    <div className="space-y-1 mb-2 bg-white/70 p-2 rounded-lg border border-amber-100">
                      <div className="flex items-start gap-1 text-slate-600 line-through">
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-1 rounded">原句</span>
                        <span className="select-text">{msg.feedback.userOriginal}</span>
                      </div>
                      <div className="flex items-start gap-1 text-emerald-800 font-medium">
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">更正</span>
                        <span className="select-text">{msg.feedback.corrected}</span>
                      </div>
                    </div>
                  )}

                  {/* Explanation in Chinese */}
                  {msg.feedback.explanationZh && (
                    <p className="text-slate-700 leading-relaxed mb-2">
                      💡 {msg.feedback.explanationZh}
                    </p>
                  )}

                  {/* Native / Advanced alternative with 1-click Add to Vocab */}
                  {msg.feedback.betterAlternative && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-amber-200/60 mt-1">
                      <div className="flex-1 pr-2">
                        <span className="text-[10px] text-amber-700 block font-medium">✨ 外教级地道说法:</span>
                        <span className="text-amber-900 font-medium select-text">
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
                          className="flex items-center gap-1 bg-amber-200/70 hover:bg-amber-300 text-amber-900 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                        >
                          {addedWordFeedback[msg.feedback.betterAlternative] ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>已收藏</span>
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="w-3 h-3" />
                              <span>存入生词本</span>
                            </>
                          )}
                        </button>
                        {addedWordFeedback[msg.feedback.betterAlternative] && onNavigateToVocab && (
                          <button
                            onClick={onNavigateToVocab}
                            className="flex items-center gap-0.5 bg-sky-100 hover:bg-sky-200 text-sky-800 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
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
      <footer className="flex-none bg-white border-t border-slate-200 p-3 pb-safe">
        {isRecording && (
          <div className="mb-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-xs text-rose-700 animate-pulse">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              <span>正在聆听你的英语发音... 请清晰说话</span>
            </div>
            <button
              onClick={toggleRecording}
              className="text-rose-800 font-semibold underline"
            >
              完成录音
            </button>
          </div>
        )}

        <div className="flex items-end space-x-2">
          {/* Mic Button */}
          <button
            type="button"
            onClick={toggleRecording}
            className={`p-3 rounded-full flex-none transition-all ${
              isRecording
                ? 'bg-rose-500 text-white ring-4 ring-rose-200 shadow-md scale-105'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            title="点击开始/停止英语语音识别"
          >
            {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Text Input */}
          <div className="flex-1 bg-slate-100 rounded-2xl flex items-center px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-sky-500/40 focus-within:bg-white border border-transparent focus-within:border-sky-300 transition-all">
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="用英语回复或点麦克风说话..."
              className="w-full bg-transparent resize-none outline-hidden text-sm text-slate-800 placeholder-slate-600 max-h-24 py-1.5"
            />
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            className={`p-3 rounded-full flex-none transition-all ${
              inputText.trim() && !isLoading
                ? 'bg-sky-600 text-white shadow-xs hover:bg-sky-700'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
}
