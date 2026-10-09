import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
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
  Cloud,
} from 'lucide-react';
import {
  StorageService,
  PROVIDER_PRESETS,
  DEFAULT_SAMPLE_WORDS,
  DEFAULT_SAMPLE_ARTICLES,
} from '../services/storage';
import { callAICompletion } from '../services/ai';
import { tts } from '../services/speech';
import { getCourseCacheCount } from '../services/offline';
import StudyHeader from './StudyHeader';
import { useToast } from './ui/toastContext';
import { Modal } from './ui/Modal';
import { clearManagedCaches, getCacheDiagnostics, requestPersistentStorage } from '../services/cacheManagement.js';
import { connectionOrigin } from '../services/storageMerge.js';

export default function Settings() {
  const toast = useToast();
  const [settings, setSettings] = useState(() => StorageService.getSettings());
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [testStatus, setTestStatus] = useState({ state: 'idle', message: '' }); // 'idle' | 'testing' | 'success' | 'error'
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [availableVoices, setAvailableVoices] = useState(() => tts.getAvailableFemaleVoices());
  const [speechStatus, setSpeechStatus] = useState(() => tts.getSpeechStatus());
  const [showSpeechKey, setShowSpeechKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [includeApiKeyInExport, setIncludeApiKeyInExport] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [includeConnections, setIncludeConnections] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [localSummary, setLocalSummary] = useState(() => StorageService.getLocalDataSummary());
  const [storageDiagnostics, setStorageDiagnostics] = useState(() => StorageService.getStorageDiagnostics());
  const [audioCacheCount, setAudioCacheCount] = useState(0);
  const [lastExportAt, setLastExportAt] = useState(() => StorageService.getAppState().lastExportAt || 0);
  const [cacheDiagnostics, setCacheDiagnostics] = useState(null);
  const [cacheBusy, setCacheBusy] = useState('');

  // Reload voices when speech system initializes
  useEffect(() => {
    const updateVoices = () => {
      tts.loadVoices();
      setAvailableVoices(tts.getAvailableFemaleVoices());
      setSpeechStatus(tts.getSpeechStatus(StorageService.getSettings()));
    };
    updateVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis?.onvoiceschanged === updateVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  useEffect(() => {
    getCourseCacheCount().then(setAudioCacheCount).catch(() => setAudioCacheCount(0));
    getCacheDiagnostics().then(setCacheDiagnostics).catch(() => setCacheDiagnostics({ supported: false, groups: [] }));
    const refresh = () => setStorageDiagnostics(StorageService.getStorageDiagnostics());
    window.addEventListener('lingoflow:storage-error', refresh);
    window.addEventListener('lingoflow:storage', refresh);
    return () => { window.removeEventListener('lingoflow:storage-error', refresh); window.removeEventListener('lingoflow:storage', refresh); };
  }, []);

  const handleClearCache = async (kind) => {
    setCacheBusy(kind);
    try {
      await clearManagedCaches(kind);
      if (kind === 'course') StorageService.clearNceCache();
      setCacheDiagnostics(await getCacheDiagnostics());
      setStorageDiagnostics(StorageService.getStorageDiagnostics());
      setAudioCacheCount(await getCourseCacheCount());
      toast.success('缓存已清理，个人学习记录保留。');
    } catch { toast.error('缓存清理失败，请稍后重试。'); }
    finally { setCacheBusy(''); }
  };

  // Sync settings when changed
  const updateSetting = (key, value) => {
    const updated = { ...settings, [key]: value };
    if (key === 'baseUrl' || key === 'speechBaseUrl') {
      const nextOrigin = connectionOrigin(value);
      if (nextOrigin && nextOrigin !== connectionOrigin(settings[key])) {
        updated[key === 'baseUrl' ? 'apiKey' : 'speechApiKey'] = '';
        toast.info('连接域名已更改，请填写该服务的密钥。');
      }
    }
    setSettings(updated);
    const saved = StorageService.saveSettings(updated);
    setSpeechStatus(tts.getSpeechStatus(updated));
    triggerSavedToast(saved);
  };

  const triggerSavedToast = (saved) => {
    // A failed write (quota / blocked storage) used to still show "已保存".
    if (saved === false) {
      setSavedSuccess(false);
      setSaveError(true);
      setTimeout(() => setSaveError(false), 4000);
      return;
    }
    setSaveError(false);
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
        apiKey: connectionOrigin(preset.baseUrl) === connectionOrigin(settings.baseUrl) ? settings.apiKey : '',
      };
      setSettings(updated);
      triggerSavedToast(StorageService.saveSettings(updated));
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
    const exportedAt = Date.now();
    StorageService.saveAppState({ ...StorageService.getAppState(), lastExportAt: exportedAt });
    setLastExportAt(exportedAt);
  };

  // Select File & Parse Preview
  const handleSelectImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast.error('备份超过 20 MB，请先检查文件是否正确。'); return; }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        const preview = StorageService.parseBackupPreview(content);
        if (preview.valid) {
          setIncludeConnections(false);
          setImportPreview({ ...preview, rawContent: content });
        } else {
          toast.error(`无法识别该备份文件: ${preview.error}`);
        }
      }
    };
    reader.onerror = () => toast.error('备份文件读取失败，请重新选择文件。');
    reader.readAsText(file);
    e.target.value = '';
  };

  // Confirm Import with Smart Merge
  const handleConfirmImport = async () => {
    if (!importPreview?.rawContent) return;
    if (importing) return;
    setImporting(true);
    const res = await StorageService.importAllDataAsync(importPreview.rawContent, { includeConnections });
    setImporting(false);
    if (res.success) {
      toast.success(
        `🎉 智能增量合并成功！`
        + ` 新增生词 ${res.addedWords} 个，更新 ${res.updatedWords} 个；`
        + ` 新增文章 ${res.addedArticles || 0} 篇；`
        + ` 新增划线批注 ${res.addedAnnotations || 0} 处；`
        + ` 当前生词库 ${res.totalWords} 词。页面即将自动刷新。`,
        { duration: 6000 },
      );
      setImportPreview(null);
      window.location.reload();
    } else {
      toast.error(`导入失败: ${res.error}`);
    }
  };

  // Reset to Sample Data with Safety Modal
  const handleConfirmReset = () => {
    const before = StorageService.snapshotImportTargets({});
    if (!StorageService.saveVocabulary(DEFAULT_SAMPLE_WORDS) || !StorageService.saveArticles(DEFAULT_SAMPLE_ARTICLES)) {
      StorageService.restoreSnapshot(before);
      toast.error('恢复失败，原有记录已保留，请检查存储空间。');
      return;
    }
    setShowResetModal(false);
    toast.success('已恢复为官方初始演示数据！');
    window.location.reload();
  };

  // Clear the built-in demo deck so the learner starts from their own words.
  const handleClearSampleData = () => {
    if (!confirm('清空示例生词与示例文章？你的学习记录、口语对话与课程进度都会保留。')) return;
    const cleared = StorageService.clearSampleData();
    if (!cleared) {
      toast.error('清空失败（可能是浏览器存储不可写），请稍后重试。');
      return;
    }
    StorageService.markOnboardingSeen('demoNoticeSeen');
    StorageService.markOnboardingSeen('sampleDataCleared');
    setLocalSummary(StorageService.getLocalDataSummary());
    setStorageDiagnostics(StorageService.getStorageDiagnostics());
    toast.success('示例数据已清空。');
  };

  // Test Voice Speech
  const handleTestSpeech = () => {
    tts.speak(
      "Hi there! I'm Echo, your English coach. I'm so excited to help you speak with natural confidence!",
      {
        mode: settings.speechMode,
        channel: 'settings',
        accent: settings.voiceAccent,
        rate: settings.voiceRate,
        voiceURI: settings.preferredVoiceURI,
      }
    );
  };

  const currentPreset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.custom;

  return (
    <div className="study-page settings-page flex flex-col h-full overflow-y-auto">
      <StudyHeader
        title="我的空间"
        icon={<SettingsIcon className="w-4 h-4" />}
        actions={
          saveError
            ? <span className="flex items-center gap-1 rounded-xl bg-rose-400/20 px-2.5 py-2 text-[11px] font-semibold text-rose-100 ring-1 ring-rose-300/30 animate-fade-in"><AlertCircle className="w-3.5 h-3.5" />未能保存</span>
            : savedSuccess
              ? <span className="flex items-center gap-1 rounded-xl bg-emerald-400/15 px-2.5 py-2 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-300/20 animate-fade-in"><CheckCircle2 className="w-3.5 h-3.5" />已保存</span>
              : null
        }
      />

      {/* Main Form Content */}
      <div className="p-4 space-y-4 max-w-md mx-auto pb-28 w-full">
        <nav className="settings-section-nav" aria-label="设置分组">
          {[['data','学习数据'],['sound','声音'],['ai','AI 连接'],['offline','应用与离线']].map(([id,label]) => <button type="button" key={id} onClick={() => { const target = document.getElementById(`settings-${id}`); if (target?.tagName === 'DETAILS') target.open = true; target?.scrollIntoView({block:'start',behavior:'smooth'}); }}>{label}</button>)}
        </nav>
        {/* PWA Mobile Install Banner */}
        <button type="button" onClick={() => setShowPwaGuide(true)} className="settings-install"><span><Smartphone size={23} /></span><div><strong>添加到主屏幕</strong></div><span aria-hidden="true">›</span></button>

        <div id="settings-data" className="study-card rounded-[26px] p-5 space-y-3.5">
          <div className="pb-2 border-b border-slate-100 flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>学习数据与备份</span>
              </h3>
            </div>
          </div>

          <details id="settings-offline" className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <summary className="cursor-pointer text-xs font-semibold text-slate-800">应用与离线缓存</summary>
            {['dictionary', 'speech', 'course'].map((kind) => {
              const label = { dictionary: '离线词典', speech: '云端朗读缓存', course: '课程音频缓存' }[kind];
              const groups = cacheDiagnostics?.groups?.filter((group) => group.kind === kind) || [];
              const bytes = groups.reduce((sum, group) => sum + group.bytes, 0);
              return <div key={kind} className="flex items-center justify-between gap-2 text-[11px]"><span>{label} · {(bytes / 1024 / 1024).toFixed(1)} MB</span><button type="button" aria-label={`清理${label}`} disabled={Boolean(cacheBusy) || !cacheDiagnostics?.supported} onClick={() => handleClearCache(kind)} className="rounded-lg bg-white px-2 py-1.5 text-sky-700 ring-1 ring-slate-200 disabled:opacity-40">{cacheBusy === kind ? '清理中…' : '清理'}</button></div>;
            })}
            <p className="text-xs text-slate-500">清理缓存会移除离线下载，学习记录保留。</p>
            <button type="button" className="text-[11px] font-semibold text-sky-700" disabled={cacheDiagnostics?.persisted} onClick={async () => { const kept = await requestPersistentStorage(); toast.info(kept ? '浏览器已允许持久保存。' : '浏览器暂未允许持久保存，请继续定期备份。'); setCacheDiagnostics(await getCacheDiagnostics()); }}>{cacheDiagnostics?.persisted ? '浏览器已允许持久保存' : '申请浏览器持久保存'}</button>
            <details className="pt-1 text-xs text-slate-500">
              <summary className="cursor-pointer">存储详情</summary>
              <p className="mt-2">练习记录：{storageDiagnostics.learningStorage?.backend === 'indexedDB' ? 'IndexedDB' : '本地存储'}；词库和文章：本地存储。</p>
              <p className="mt-1">约 {storageDiagnostics.approximateMegabytes} MB · {storageDiagnostics.studyEventCount} 条学习记录 · {storageDiagnostics.nceLessonCacheCount} 课字幕 · {audioCacheCount} 课音频</p>
              <p className="mt-1">云端朗读缓存上限：64 条 / 8 MB。数据版本 v{localSummary.schemaVersion || 4}。</p>
            </details>
          </details>
          {storageDiagnostics.learningStorage?.fallbackReason && <output className="block text-xs text-amber-800">数据库暂不可用：{storageDiagnostics.learningStorage.fallbackReason}。本次使用本地存储，先前记录保留。</output>}
          {storageDiagnostics.conflictCount > 0 && <output className="block text-xs text-amber-800">有 {storageDiagnostics.conflictCount} 处同时编辑的内容，两个版本会随备份导出，请检查。</output>}

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
            {/* A failed write (quota / blocked storage) used to be recorded but never shown,
                so ratings, streaks and events could silently fail to persist. */}
            {storageDiagnostics.lastWriteError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
                <p className="font-semibold">
                  {storageDiagnostics.lastWriteError.quotaExceeded
                    ? '⚠️ 本地存储已写满，最近一次保存失败'
                    : '⚠️ 最近一次保存失败（浏览器可能禁用了本地存储）'}
                </p>
                <p className="mt-1">
                  受影响的键：<span className="font-mono">{storageDiagnostics.lastWriteError.key}</span>
                  。请先<strong>导出备份</strong>，再释放存储空间后重试。
                </p>
              </div>
            )}

          {/* API Key Security Toggle for Export */}
          <div className="p-2.5 bg-sky-50/60 border border-sky-200/70 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-sky-900 block text-xs">
                备份包含 API Key
              </span>
              <span className="text-[10.5px] text-slate-500 block">
                {includeApiKeyInExport
                  ? '包含密钥原文，请勿公开分享。'
                  : '默认不含密钥，请妥善保管学习记录。'}
              </span>
            </div>
            <input
              type="checkbox"
              checked={includeApiKeyInExport}
              aria-label="导出时包含 API Key"
              onChange={(e) => setIncludeApiKeyInExport(e.target.checked)}
              className="w-4 h-4 accent-sky-600 rounded"
            />
          </div>

          <p className="text-xs text-slate-500">{lastExportAt ? `最近发起导出：${new Date(lastExportAt).toLocaleString()}。请确认备份文件已保存。` : '还没有导出过备份，建议定期保存学习记录。'}</p>
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
              <span>导入备份</span>
              <input
                type="file"
                accept=".json"
                onChange={handleSelectImportFile}
                className="hidden"
              />
            </label>
          </div>

          {/* Demo data: the same "30 个演示生词" the home screen explains on first run. */}
          {StorageService.isUsingSampleVocabulary() && <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-900">
                当前词库是示例数据
              </p>
              <p className="mt-0.5 text-[10.5px] leading-4 text-amber-800">
                清空示例词与文章，学习记录保留。
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearSampleData}
              disabled={!StorageService.isUsingSampleVocabulary()}
              className="flex-none rounded-xl bg-amber-500 px-2.5 py-1.5 text-[10.5px] font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              清空示例数据
            </button>
          </div>}

          {/* Danger Zone */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">重置</span>
            <button
              onClick={() => setShowResetModal(true)}
              className="text-slate-400 hover:text-rose-600 text-xs flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复示例数据</span>
            </button>
          </div>
        </div>

        {/* Section 1: AI Model Configuration */}
        <details id="settings-ai" className="settings-group">
        <summary>AI 连接</summary>
        <div className="study-card rounded-[26px] p-5 space-y-3.5">
          <div className="flex justify-end">
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
            <label htmlFor="settings-provider" className="block text-xs font-semibold text-slate-700 mb-1">
              AI 服务商
            </label>
            <select id="settings-provider"
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
            <label htmlFor="settings-apiKey" className="block text-xs font-semibold text-slate-700 mb-1">
              API Key
            </label>
            <div className="relative flex items-center">
              <input id="settings-apiKey"
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => updateSetting('apiKey', e.target.value)}
                placeholder="sk-..."
                className="w-full text-xs font-mono px-3 py-2 pr-10 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden bg-white/90"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? '隐藏 AI API Key' : '显示 AI API Key'}
                className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-1"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">密钥保存在此浏览器，并用于连接所选服务商。</p>
          </div>

          {/* Advanced Collapse Toggle */}
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-slate-500 hover:text-sky-600 flex items-center gap-1 font-medium transition-colors"
            >
              <span>{showAdvanced ? '收起接口与模型 ▲' : '接口与模型 ▼'}</span>
            </button>
          </div>

          {/* Collapsible Advanced inputs */}
          {showAdvanced && (
            <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-3 animate-fade-in">
              {/* Base URL */}
              <div>
                <label htmlFor="settings-baseUrl" className="block text-[11px] font-semibold text-slate-600 mb-1">
                  接口地址
                </label>
                <input id="settings-baseUrl"
                  type="text"
                  value={settings.baseUrl}
                  onChange={(e) => updateSetting('baseUrl', e.target.value)}
                  placeholder="https://api.deepseek.com"
                  className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              {/* Model */}
              <div>
                <label htmlFor="settings-model" className="block text-[11px] font-semibold text-slate-600 mb-1">
                  模型
                </label>
                <input id="settings-model"
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
                {testStatus.state === 'testing' ? '正在测试…' : '测试连接'}
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
        </details>
        <details id="settings-sound" className="settings-group">
        <summary>声音</summary>
        <div className="study-card rounded-[26px] p-5 space-y-3.5">
          <div className="flex justify-end">
            <button
              onClick={handleTestSpeech}
              className="text-xs text-sky-600 hover:underline flex items-center gap-1"
            >
              <Volume2 className="w-4 h-4" />
              <span>试听发音</span>
            </button>
          </div>

          {/* Non-course speech mode */}
          <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-3.5">
            <p className="text-xs font-semibold text-sky-950">朗读方式</p>
            <select
              value={settings.speechMode || 'natural'}
              aria-label="非课文朗读方式"
              onChange={(e) => updateSetting('speechMode', e.target.value)}
              className="mt-3 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
            >
              <option value="natural">✨ 自然音色优先（推荐）</option>
              <option value="cloud">☁️ 云端真人感（需配置语音接口）</option>
              <option value="system">设备系统语音</option>
            </select>
            {settings.speechMode === 'cloud' && <p className="mt-2 text-xs text-sky-800">{speechStatus.cloudConfigured ? '云端语音已配置' : '请展开下方云端语音配置'}</p>}
          </div>

          {/* Accent */}
          <div>
            <label htmlFor="settings-voiceAccent" className="block text-xs font-medium text-slate-700 mb-1">
              口音偏好
            </label>
            <select id="settings-voiceAccent"
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
            <label htmlFor="settings-preferredVoiceURI" className="block text-xs font-medium text-slate-700 mb-1">
              音色
            </label>
            <select id="settings-preferredVoiceURI"
              value={settings.preferredVoiceURI || ''}
              onChange={(e) => updateSetting('preferredVoiceURI', e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
            >
              <option value="">自动选择</option>
              {availableVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  👩 {v.name} · {tts.getVoiceQualityLabel(v)} ({v.lang})
                </option>
              ))}
            </select>
            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer">朗读说明</summary>
              <p className="mt-2">这些设置用于单词、精读与口语，新概念课文继续使用原声。</p>
              <p className="mt-1">自动选择优先使用自然音色，没有可用音色时使用系统语音。本机有 {speechStatus.naturalVoiceCount} 个自然音色、{speechStatus.enhancedVoiceCount} 个增强音色。</p>
            </details>
          </div>

          <details className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-slate-700">
              <Cloud className="h-4 w-4 text-sky-600" />配置云端自然语音（可选）
            </summary>
            <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
              <p className="text-[11px] leading-5 text-slate-500">
                支持 OpenAI 兼容语音接口，密钥保存在此浏览器。
              </p>
              <div>
                <label htmlFor="settings-speechBaseUrl" className="mb-1 block text-[11px] font-medium text-slate-600">语音接口地址</label>
                <input id="settings-speechBaseUrl"
                  value={settings.speechBaseUrl || ''}
                  onChange={(e) => updateSetting('speechBaseUrl', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label htmlFor="settings-speechApiKey" className="mb-1 block text-[11px] font-medium text-slate-600">语音 API Key</label>
                <div className="relative">
                  <input id="settings-speechApiKey"
                    type={showSpeechKey ? 'text' : 'password'}
                    value={settings.speechApiKey || ''}
                    onChange={(e) => updateSetting('speechApiKey', e.target.value)}
                    placeholder="输入后点击上方试听"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 text-xs outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSpeechKey((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showSpeechKey ? '隐藏语音 API Key' : '显示语音 API Key'}
                  >
                    {showSpeechKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="settings-speechModel" className="mb-1 block text-[11px] font-medium text-slate-600">模型</label>
                  <input id="settings-speechModel"
                    value={settings.speechModel || ''}
                    onChange={(e) => updateSetting('speechModel', e.target.value)}
                    placeholder="gpt-4o-mini-tts"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label htmlFor="settings-speechVoice" className="mb-1 block text-[11px] font-medium text-slate-600">音色</label>
                  <select id="settings-speechVoice"
                    value={settings.speechVoice || 'coral'}
                    onChange={(e) => updateSetting('speechVoice', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-sky-500"
                  >
                    <option value="coral">Coral · 温暖女声</option>
                    <option value="marin">Marin · 清晰自然</option>
                    <option value="cedar">Cedar · 稳重自然</option>
                    <option value="nova">Nova · 明亮女声</option>
                    <option value="shimmer">Shimmer · 柔和女声</option>
                    <option value="alloy">Alloy · 中性自然</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="settings-speechInstructions" className="mb-1 block text-[11px] font-medium text-slate-600">语气提示（可选）</label>
                <textarea id="settings-speechInstructions"
                  value={settings.speechInstructions || ''}
                  onChange={(e) => updateSetting('speechInstructions', e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-sky-500"
                />
              </div>
              <p className="text-[10px] leading-4 text-amber-700">
                朗读文字会发送至配置的服务，并可能产生费用。
              </p>
            </div>
          </details>

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
              aria-label="朗读语速"
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
              <span>慢</span>
              <span>正常</span>
              <span>快</span>
            </div>
          </div>

          {/* Auto play audio toggle */}
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-xs font-medium text-slate-800 block">
                自动朗读口语回复
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.autoPlayOralAudio}
              aria-label="口语对练自动朗读回复"
              onChange={(e) => updateSetting('autoPlayOralAudio', e.target.checked)}
              className="w-4 h-4 accent-sky-600 rounded"
            />
          </div>
        </div>

        {/* Section 3: Data Management & Cross-device sync 2.0 */}
        </details>
      </div>

      {/* Import Preview Modal
          NOTE: rendered conditionally — React evaluates JSX children before the component
          runs, so a closed `<Modal open={false}>` still evaluates `importPreview.exportedAt`
          and takes the whole page down. */}
      {importPreview && (
      <Modal
        open
        ariaLabel="备份文件解析与合并预览"
        onClose={() => { if (!importing) setImportPreview(null); }}
        closeOnBackdrop={!importing}
        size="sm"
        showCloseButton={false}
        bodyClassName="space-y-3.5 p-5"
      >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">📦</span>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">备份预览</h3>
                  <p className="text-[10.5px] text-slate-500">生成时间: {importPreview.exportedAt}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs space-y-2">
              <p>练习草稿 {importPreview.sessionCount} 份 · 阅读证据 {importPreview.readingEvidenceCount} 份 · 口语纠错 {importPreview.oralCorrectionCount} 条</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeConnections} onChange={(event) => setIncludeConnections(event.target.checked)} />同时恢复 AI 连接配置</label>
              {importPreview.connectionChanges?.map((change) => <p key={change.field} className="break-all text-xs text-slate-600">{{ baseUrl: 'AI 服务', speechBaseUrl: '语音服务', model: 'AI 模型', speechModel: '语音模型' }[change.field] || change.field}：{change.current || '未配置'} → {change.incoming || '未配置'}</p>)}
              <p className="text-xs text-slate-600">默认仅合并学习数据与偏好。勾选后会恢复连接配置，域名改变时清空旧密钥。</p>
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
                  {importPreview.hasApiKey ? '是（勾选连接配置后导入）' : '否'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded-xl border border-emerald-200/60 leading-relaxed">
              导入会合并现有学习记录。
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setImportPreview(null)}
                disabled={importing}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className="flex-1 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
              >
                {importing ? '正在恢复…' : '确认导入'}
              </button>
            </div>
      </Modal>
      )}

      {/* Safety Reset Modal */}
      <Modal
        open={showResetModal}
        ariaLabel="恢复示例数据"
        onClose={() => setShowResetModal(false)}
        size="sm"
        showCloseButton={false}
        bodyClassName="space-y-3.5 p-5"
      >
            <div className="flex items-center gap-2 pb-2 border-b border-rose-100 text-rose-700 font-bold text-sm">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              <span>恢复示例数据</span>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              将恢复 <strong>30 个示例生词</strong> 与 <strong>8 篇示例文章</strong>，替换当前词库和文章。
            </p>

            <p className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-xl border border-amber-200/80 leading-tight">
              请先<strong>导出全量备份</strong>，以便恢复个人内容。
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmReset}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              >
                确认恢复
              </button>
            </div>
      </Modal>

      {/* PWA Mobile Add to Screen Guide Modal */}
      <Modal
        open={showPwaGuide}
        onClose={() => setShowPwaGuide(false)}
        size="md"
        showCloseButton={false}
        bodyClassName="space-y-3 p-5 pt-3"
      >
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
      </Modal>
    </div>
  );
}
