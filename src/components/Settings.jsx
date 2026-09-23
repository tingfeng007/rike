import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Key,
  Volume2,
  Download,
  Upload,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Smartphone,
  ExternalLink,
  Zap,
  HardDrive,
  Trash2,
} from 'lucide-react';
import {
  StorageService,
  PROVIDER_PRESETS,
  DEFAULT_SAMPLE_WORDS,
  DEFAULT_SAMPLE_ARTICLES,
} from '../services/storage';
import { callAICompletion } from '../services/ai';
import { tts } from '../services/speech';
import { clearCourseCaches, getCourseCacheCount } from '../services/offline';
import StudyHeader from './StudyHeader';

export default function Settings() {
  const [settings, setSettings] = useState(() => StorageService.getSettings());
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState({ state: 'idle', message: '' }); // 'idle' | 'testing' | 'success' | 'error'
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [availableVoices, setAvailableVoices] = useState(() => tts.getAvailableFemaleVoices());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [includeApiKeyInExport, setIncludeApiKeyInExport] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [localSummary] = useState(() => StorageService.getLocalDataSummary());
  const [storageDiagnostics, setStorageDiagnostics] = useState(() => StorageService.getStorageDiagnostics());
  const [audioCacheCount, setAudioCacheCount] = useState(0);

  // Reload voices when speech system initializes
  useEffect(() => {
    const updateVoices = () => {
      setAvailableVoices(tts.getAvailableFemaleVoices());
    };
    updateVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  useEffect(() => {
    getCourseCacheCount().then(setAudioCacheCount).catch(() => setAudioCacheCount(0));
  }, []);

  // Sync settings when changed
  const updateSetting = (key, value) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    StorageService.saveSettings(updated);
    triggerSavedToast();
  };

  const triggerSavedToast = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  // Provider Preset change
  const handleProviderChange = (providerKey) => {
    const preset = PROVIDER_PRESETS[providerKey];
    if (preset) {
      const updated = {
        ...settings,
        provider: providerKey,
        baseUrl: preset.baseUrl,
        model: preset.defaultModel,
      };
      setSettings(updated);
      StorageService.saveSettings(updated);
      triggerSavedToast();
    }
  };

  // Test API Connectivity
  const handleTestAPI = async () => {
    if (!settings.apiKey?.trim()) {
      setTestStatus({
        state: 'error',
        message: '请先输入 API Key 再进行测试',
      });
      return;
    }

    setTestStatus({ state: 'testing', message: '正在向 AI 发送测试请求...' });

    try {
      const reply = await callAICompletion({
        messages: [
          { role: 'user', content: 'Reply only with "API Connection Successful!" in English.' },
        ],
        temperature: 0.3,
      });

      setTestStatus({
        state: 'success',
        message: `测试成功！AI响应: "${reply.trim()}"`,
      });
    } catch (err) {
      setTestStatus({
        state: 'error',
        message: `测试失败: ${err.message}`,
      });
    }
  };

  // Export Data as JSON 2.0
  const handleExportData = () => {
    const jsonStr = StorageService.exportAllData({ includeApiKey: includeApiKeyInExport });
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const keyTag = includeApiKeyInExport ? '_withKey' : '_safe';
    a.download = `lingoflow_backup_${new Date().toISOString().slice(0, 10)}${keyTag}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearCourseCache = () => {
    if (!confirm('清除课程缓存后，学习进度和生词不会删除；下次打开课程会重新联网下载。确定继续吗？')) return;
    Promise.all([clearCourseCaches(), Promise.resolve(StorageService.clearNceCache())]).then(() => {
      setAudioCacheCount(0);
      setStorageDiagnostics(StorageService.getStorageDiagnostics());
      alert('课程缓存已清除，学习记录仍然保留。');
    });
  };

  // Select File & Parse Preview
  const handleSelectImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        const preview = StorageService.parseBackupPreview(content);
        if (preview.valid) {
          setImportPreview({ ...preview, rawContent: content });
        } else {
          alert(`无法识别该备份文件: ${preview.error}`);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Confirm Import with Smart Merge
  const handleConfirmImport = () => {
    if (!importPreview?.rawContent) return;
    const res = StorageService.importAllData(importPreview.rawContent);
    if (res.success) {
      alert(
        `🎉 智能增量合并成功！\n` +
        `• 新增生词: ${res.addedWords} 个，更新同步: ${res.updatedWords} 个\n` +
        `• 新增文章: ${res.addedArticles || 0} 篇\n` +
        `• 新增划线批注: ${res.addedAnnotations || 0} 处\n` +
        `• 当前生词库总量: ${res.totalWords} 词\n` +
        `页面即将自动刷新加载最新数据。`
      );
      setImportPreview(null);
      window.location.reload();
    } else {
      alert(`导入失败: ${res.error}`);
    }
  };

  // Reset to Sample Data with Safety Modal
  const handleConfirmReset = () => {
    StorageService.saveVocabulary(DEFAULT_SAMPLE_WORDS);
    StorageService.saveArticles(DEFAULT_SAMPLE_ARTICLES);
    setShowResetModal(false);
    alert('已恢复为官方初始演示数据！');
    window.location.reload();
  };

  // Test Voice Speech
  const handleTestSpeech = () => {
    tts.speak(
      "Hi there! I'm Echo, your English coach. I'm so excited to help you speak with natural confidence!",
      {
        accent: settings.voiceAccent,
        rate: settings.voiceRate,
        voiceURI: settings.preferredVoiceURI,
      }
    );
  };

  const currentPreset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.custom;

  return (
    <div className="study-page flex flex-col h-full overflow-y-auto">
      <StudyHeader
        eyebrow="MY LINGOFLOW · LOCAL FIRST"
        title="设备与服务"
        description="先保证学习记录安全，再按需连接 AI 与调整语音。所有设置自动保存在当前浏览器。"
        icon={<SettingsIcon className="w-4 h-4" />}
        status="本地优先"
        actions={savedSuccess ? <span className="flex items-center gap-1 rounded-xl bg-emerald-400/15 px-2.5 py-2 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-300/20 animate-fade-in"><CheckCircle2 className="w-3.5 h-3.5" />已保存</span> : null}
      />

      {/* Main Form Content */}
      <div className="p-4 space-y-4 max-w-md mx-auto pb-28 w-full">
        {/* PWA Mobile Install Banner */}
        <div className="paper-grain rounded-[26px] border border-[#dfd2b9] bg-[#f3e7ce] p-5 text-[#102a43] shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold bg-[#102a43] text-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                安装到主屏幕
              </span>
              <h3 className="text-base font-bold tracking-tight">添加到手机主屏幕 (PWA)</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                无需应用商店；从 Safari 或 Chrome 添加后，可全屏打开并保留本地学习记录。
              </p>
            </div>
            <Smartphone className="w-7 h-7 text-amber-700 flex-none ml-2" />
          </div>

          <button
            onClick={() => setShowPwaGuide(true)}
            className="mt-3 bg-[#102a43] text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-xs transition-colors active:scale-95"
          >
            查看苹果/安卓添加教程
          </button>
        </div>

        {/* Section 1: AI Model Configuration */}
        <div className="study-card rounded-[26px] p-5 space-y-3.5">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">
                AI 核心配置 (大模型连接)
              </h3>
            </div>
            {currentPreset.helpUrl && (
              <a
                href={currentPreset.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-600 font-medium hover:underline flex items-center gap-1"
              >
                <span>获取 Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Provider Preset */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              选择 AI 服务商 (支持 OpenAI 兼容协议)
            </label>
            <select
              value={settings.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white/90 focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
            >
              {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              API Key（保存在当前浏览器，并直接用于连接所选 AI 服务商）*
            </label>
            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => updateSetting('apiKey', e.target.value)}
                placeholder="sk-..."
                className="w-full text-xs font-mono px-3 py-2 pr-10 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden bg-white/90"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-1"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Advanced Collapse Toggle */}
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-slate-500 hover:text-sky-600 flex items-center gap-1 font-medium transition-colors"
            >
              <span>{showAdvanced ? '收起高级极客参数 ▲' : '展开高级参数 (Base URL / 换模型) ▼'}</span>
            </button>
          </div>

          {/* Collapsible Advanced inputs */}
          {showAdvanced && (
            <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-3 animate-fade-in">
              {/* Base URL */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  API 基础路径 (Base URL)
                </label>
                <input
                  type="text"
                  value={settings.baseUrl}
                  onChange={(e) => updateSetting('baseUrl', e.target.value)}
                  placeholder="https://api.deepseek.com"
                  className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  调用模型名称 (Model)
                </label>
                <input
                  type="text"
                  value={settings.model}
                  onChange={(e) => updateSetting('model', e.target.value)}
                  placeholder="deepseek-chat"
                  className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>
            </div>
          )}

          {/* Test Button & Feedback */}
          <div className="pt-1">
            <button
              onClick={handleTestAPI}
              disabled={testStatus.state === 'testing'}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>
                {testStatus.state === 'testing' ? '正在连接测试...' : '🧪 测试 API 连接状态'}
              </span>
            </button>

            {testStatus.message && (
              <div
                className={`mt-2 p-2.5 rounded-xl text-xs flex items-start gap-2 ${
                  testStatus.state === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {testStatus.state === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-none mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-none mt-0.5" />
                )}
                <span className="leading-relaxed">{testStatus.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Speech & TTS Settings */}
        <div className="study-card rounded-[26px] p-5 space-y-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-850">
                发音与语音偏好
              </h3>
            </div>
            <button
              onClick={handleTestSpeech}
              className="text-xs text-sky-600 hover:underline flex items-center gap-1"
            >
              <span>试听发音</span>
            </button>
          </div>

          {/* Accent */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              口音偏好
            </label>
            <select
              value={settings.voiceAccent}
              onChange={(e) => updateSetting('voiceAccent', e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
            >
              <option value="en-US">美式英语 (American English - en-US)</option>
              <option value="en-GB">英式英语 (British English - en-GB)</option>
            </select>
          </div>

          {/* Voice Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              外教音色选择 (精选自然女声)
            </label>
            <select
              value={settings.preferredVoiceURI || ''}
              onChange={(e) => updateSetting('preferredVoiceURI', e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
            >
              <option value="">✨ 智能优选（iPhone 推荐：Ava / Samantha 自然甜美女声）</option>
              {availableVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  👩 {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-600 mt-1">
              💡 默认优先匹配苹果 iOS 高品质自然女声，音色更甜美、抑扬顿挫更地道。
            </p>
          </div>

          {/* Voice Rate Slider */}
          <div>
            <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
              <span>朗读语速</span>
              <span className="text-sky-600 font-semibold">
                {settings.voiceRate}x
              </span>
            </div>
            <input
              type="range"
              min="0.7"
              max="1.2"
              step="0.05"
              value={settings.voiceRate}
              onChange={(e) =>
                updateSetting('voiceRate', parseFloat(e.target.value))
              }
              className="w-full accent-sky-600"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
              <span>0.7x (初学者慢速)</span>
              <span>1.0x (常速)</span>
              <span>1.2x (挑战快速)</span>
            </div>
          </div>

          {/* Auto play audio toggle */}
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-xs font-medium text-slate-800 block">
                口语对练时自动朗读 AI 回复
              </span>
              <span className="text-[11px] text-slate-600">
                收到外教回复时立即进行语音跟读
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.autoPlayOralAudio}
              onChange={(e) => updateSetting('autoPlayOralAudio', e.target.checked)}
              className="w-4 h-4 accent-sky-600 rounded"
            />
          </div>
        </div>

        {/* Section 3: Data Management & Cross-device sync 2.0 */}
        <div className="study-card rounded-[26px] p-5 space-y-3.5">
          <div className="pb-2 border-b border-slate-100 flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>🛡️ 全量安全备份与跨端迁移 2.0</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                完整囊括生词库、外刊、划线批注、课程错题、试卷与打卡记录
              </p>
            </div>
          </div>

          {/* Local Data Landscape Summary */}
          <div className="grid grid-cols-5 gap-1 bg-slate-50/80 p-2.5 rounded-2xl border border-slate-200/60 text-center text-xs">
            <div className="p-1">
              <span className="text-[10px] text-slate-500 block">课程进度</span>
              <strong className="text-sky-700 text-sm font-mono">{localSummary.nceCompletedCount}/{localSummary.nceStartedCount}</strong>
            </div>
            <div className="p-1">
              <span className="text-[10px] text-slate-500 block">生词总数</span>
              <strong className="text-slate-800 text-sm font-mono">{localSummary.vocabCount}</strong>
            </div>
            <div className="p-1">
              <span className="text-[10px] text-slate-500 block">精选文章</span>
              <strong className="text-slate-800 text-sm font-mono">{localSummary.articleCount}</strong>
            </div>
            <div className="p-1">
              <span className="text-[10px] text-slate-500 block">划线批注</span>
              <strong className="text-amber-700 text-sm font-mono">{localSummary.annotationCount}</strong>
            </div>
            <div className="p-1">
              <span className="text-[10px] text-slate-500 block">打卡天数</span>
              <strong className="text-emerald-700 text-sm font-mono">{localSummary.streakDays}天</strong>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">已保存 {localSummary.nceExamCount} 份新概念试卷；未交卷草稿也随备份导出。数据结构 v{localSummary.schemaVersion || 3}，升级会自动迁移。</p>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-sky-700" /><div><p className="text-xs font-semibold text-sky-900">本地存储与课程缓存</p><p className="mt-0.5 text-[10.5px] text-slate-500">约 {storageDiagnostics.approximateMegabytes} MB · {storageDiagnostics.studyEventCount} 条学习记录 · {storageDiagnostics.nceLessonCacheCount} 课字幕 · {audioCacheCount} 课音频</p></div></div>
              <button type="button" onClick={handleClearCourseCache} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-100 hover:bg-sky-100"><Trash2 className="h-3 w-3" />清理课程缓存</button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">清理只移除课程目录和字幕缓存，不会删除单词、错题、试卷和学习进度。</p>
          </div>

          {/* API Key Security Toggle for Export */}
          <div className="p-2.5 bg-sky-50/60 border border-sky-200/70 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-sky-900 block text-xs">
                {includeApiKeyInExport ? '⚠️ 导出时包含 API Key (高风险)' : '🔒 安全模式：默认排除 API Key'}
              </span>
              <span className="text-[10.5px] text-slate-500 block">
                {includeApiKeyInExport
                  ? '备份文件内包含密钥原文，切勿通过微信群或公开网盘传输！'
                  : '不含密钥，但仍有个人学习记录，请妥善保管备份文件'}
              </span>
            </div>
            <input
              type="checkbox"
              checked={includeApiKeyInExport}
              onChange={(e) => setIncludeApiKeyInExport(e.target.checked)}
              className="w-4 h-4 accent-sky-600 rounded"
            />
          </div>

          {/* Export & Import Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button
              onClick={handleExportData}
              className="py-2.5 px-3 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出全量备份</span>
            </button>

            <label className="py-2.5 px-3 bg-white hover:bg-slate-50 text-slate-700 font-bold border border-slate-200/80 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition-all active:scale-95">
              <Upload className="w-3.5 h-3.5 text-sky-600" />
              <span>导入恢复 (带预览)</span>
              <input
                type="file"
                accept=".json"
                onChange={handleSelectImportFile}
                className="hidden"
              />
            </label>
          </div>

          {/* Danger Zone */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">误操作急救</span>
            <button
              onClick={() => setShowResetModal(true)}
              className="text-slate-400 hover:text-rose-600 text-xs flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复官方初始演示数据...</span>
            </button>
          </div>
        </div>
      </div>

      {/* Import Preview Modal */}
      {importPreview && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">📦</span>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">备份文件解析与合并预览</h3>
                  <p className="text-[10.5px] text-slate-500">生成时间: {importPreview.exportedAt}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/70 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">备份生词量:</span>
                <strong className="text-slate-800 font-mono">{importPreview.vocabCount} 词</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">备份文章量:</span>
                <strong className="text-slate-800 font-mono">{importPreview.articleCount} 篇</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">划线与心得批注:</span>
                <strong className="text-amber-700 font-mono">{importPreview.annotationCount} 处</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">对话场景历史:</span>
                <strong className="text-slate-800 font-mono">{importPreview.chatCount} 个</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">新概念课程进度:</span>
                <strong className="text-sky-700 font-mono">{importPreview.nceProgressCount || 0} 课</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">试卷记录与草稿:</span>
                <strong className="text-sky-700 font-mono">{importPreview.nceExamCount || 0} 份{importPreview.hasNceDraft ? ' · 有未交卷草稿' : ''}</strong>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200/60">
                <span className="text-slate-500">包含 API Key:</span>
                <span className={importPreview.hasApiKey ? 'text-amber-700 font-bold' : 'text-slate-500'}>
                  {importPreview.hasApiKey ? '是 (将保留/更新)' : '否 (安全无密钥)'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded-xl border border-emerald-200/60 leading-relaxed">
              ✨ <strong>智能增量合并保护</strong>：导入将保留你当前设备上已有的个人笔记与更高掌握阶段，绝不暴力抹除！
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setImportPreview(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmImport}
                className="flex-1 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
              >
                确认增量合并导入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-rose-100 space-y-3.5">
            <div className="flex items-center gap-2 pb-2 border-b border-rose-100 text-rose-700 font-bold text-sm">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              <span>重置确认（危险操作）</span>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              此操作将恢复官方初始的 <strong>30 个演示生词</strong> 与 <strong>8 篇经典外刊</strong>。你后来添加的个人词条与笔记将被重置。
            </p>

            <p className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-xl border border-amber-200/80 leading-tight">
              💡 强烈建议在重置前，先点击上方“<strong>导出全量备份</strong>”保存一份 JSON 文件防身！
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                放弃重置
              </button>
              <button
                onClick={handleConfirmReset}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              >
                确认重置为初始数据
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PWA Mobile Add to Screen Guide Modal */}
      {showPwaGuide && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 shadow-xl border border-slate-200 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-850 text-base">
                📱 手机添加到主屏幕教学
              </h3>
              <button
                onClick={() => setShowPwaGuide(false)}
                className="text-slate-500 hover:text-slate-700 text-sm font-bold"
              >
                关闭
              </button>
            </div>

            <div className="py-3 space-y-4 text-xs text-slate-700 leading-relaxed">
              {/* iOS Tutorial */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                <span className="font-bold text-sky-800 text-sm block">
                  🍎 iPhone (苹果 iOS 教学)
                </span>
                <ol className="list-decimal list-inside space-y-1.5 pl-1">
                  <li>在 iPhone 上使用系统自带的 <strong>Safari 浏览器</strong> 打开本网址。</li>
                  <li>点击浏览器底部的 <strong>分享按钮</strong>（一个小正方形带向上的箭头 📤）。</li>
                  <li>在弹出的菜单中往下滑，找到并点击 <strong>“添加到主屏幕” (Add to Home Screen)</strong> ➕。</li>
                  <li>点击右上角“添加”，你的桌面就会出现独立的 LingoFlow 图标，点击即全屏运行！</li>
                </ol>
              </div>

              {/* Android Tutorial */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                <span className="font-bold text-emerald-800 text-sm block">
                  🤖 Android (安卓手机教学)
                </span>
                <ol className="list-decimal list-inside space-y-1.5 pl-1">
                  <li>在安卓手机上使用 <strong>Chrome、Edge 或系统浏览器</strong> 打开本网址。</li>
                  <li>点击浏览器右上角的 <strong>三个点菜单 ⋮</strong>。</li>
                  <li>点击 <strong>“安装应用”</strong> 或 <strong>“添加到主屏幕”</strong>。</li>
                  <li>确认添加后，即安装为一个完全独立的本地 App。</li>
                </ol>
              </div>
            </div>

            <button
              onClick={() => setShowPwaGuide(false)}
              className="w-full mt-2 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold shadow-xs"
            >
              我知道了，去体验
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
