import React, { useState } from 'react';
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
} from 'lucide-react';
import {
  StorageService,
  PROVIDER_PRESETS,
  DEFAULT_SAMPLE_WORDS,
  DEFAULT_SAMPLE_ARTICLES,
} from '../services/storage';
import { callAICompletion } from '../services/ai';
import { tts } from '../services/speech';

export default function Settings() {
  const [settings, setSettings] = useState(() => StorageService.getSettings());
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState({ state: 'idle', message: '' }); // 'idle' | 'testing' | 'success' | 'error'
  const [showPwaGuide, setShowPwaGuide] = useState(false);

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

  // Export Data as JSON
  const handleExportData = () => {
    const jsonStr = StorageService.exportAllData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lingoflow_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import Data from JSON
  const handleImportData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        const res = StorageService.importAllData(content);
        if (res.success) {
          alert(`导入成功！共恢复了 ${res.count} 个生词卡片及相关设置。页面即将刷新。`);
          window.location.reload();
        } else {
          alert(`导入失败: ${res.error}`);
        }
      }
    };
    reader.readAsText(file);
  };

  // Reset to Sample Data
  const handleResetData = () => {
    if (confirm('确认恢复默认演示数据？现有的个人生词记录将被覆盖。建议先导出备份！')) {
      StorageService.saveVocabulary(DEFAULT_SAMPLE_WORDS);
      StorageService.saveArticles(DEFAULT_SAMPLE_ARTICLES);
      alert('已重置为默认数据！');
      window.location.reload();
    }
  };

  // Test Voice Speech
  const handleTestSpeech = () => {
    tts.speak('Hello there! Your speech synthesis audio is working beautifully.', {
      accent: settings.voiceAccent,
      rate: settings.voiceRate,
    });
  };

  const currentPreset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.custom;

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-y-auto">
      {/* Top Header */}
      <header className="flex-none bg-white border-b border-slate-200 px-4 py-3 shadow-xs flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center space-x-2">
          <SettingsIcon className="w-5 h-5 text-sky-600" />
          <h2 className="font-semibold text-slate-850 text-sm">
            个人自用配置与服务
          </h2>
        </div>

        {savedSuccess && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-md animate-fade-in">
            <CheckCircle2 className="w-3.5 h-3.5" />
            已自动保存
          </span>
        )}
      </header>

      {/* Main Form Content */}
      <div className="p-4 space-y-5 max-w-xl mx-auto pb-24 w-full">
        {/* PWA Mobile Install Banner */}
        <div className="bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl p-4 text-white shadow-xs">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold bg-white/20 px-2 py-0.5 rounded-full">
                移动端畅玩
              </span>
              <h3 className="text-base font-bold">添加到手机主屏幕 (PWA)</h3>
              <p className="text-xs text-white/80 leading-relaxed">
                无需通过应用商店，直接在 iPhone Safari 或安卓 Chrome 中添加到主屏幕，享受全屏原生体验！
              </p>
            </div>
            <Smartphone className="w-8 h-8 text-white/80 flex-none ml-2" />
          </div>

          <button
            onClick={() => setShowPwaGuide(true)}
            className="mt-3 bg-white text-sky-700 hover:bg-sky-50 text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs transition-colors"
          >
            查看苹果/安卓添加教程
          </button>
        </div>

        {/* Section 1: AI Model Configuration */}
        <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200/80 space-y-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-850">
                AI 核心配置 (大模型连接)
              </h3>
            </div>
            {currentPreset.helpUrl && (
              <a
                href={currentPreset.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-600 hover:underline flex items-center gap-1"
              >
                <span>获取 Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Provider Preset */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              选择 AI 服务商 (支持 OpenAI 兼容协议)
            </label>
            <select
              value={settings.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
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
            <label className="block text-xs font-medium text-slate-700 mb-1">
              API Key (保存在手机本地浏览器中，绝不上报服务器) *
            </label>
            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => updateSetting('apiKey', e.target.value)}
                placeholder="sk-..."
                className="w-full text-xs font-mono px-3 py-2 pr-10 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 text-slate-500 hover:text-slate-600 p-1"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              API 基础路径 (Base URL)
            </label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => updateSetting('baseUrl', e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              调用模型名称 (Model)
            </label>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => updateSetting('model', e.target.value)}
              placeholder="deepseek-chat"
              className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
            />
          </div>

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
        <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200/80 space-y-3.5">
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

        {/* Section 3: Data Management & Cross-device sync */}
        <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200/80 space-y-3">
          <div className="pb-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-850">
              数据备份与跨设备同步 (自用无云端泄露)
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              因为你同时使用苹果和安卓手机，随时点击导出即可生成备份文件，发到微信或网盘在另一台手机一键导入恢复！
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={handleExportData}
              className="py-2.5 px-3 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出备份 (JSON)</span>
            </button>

            <label className="py-2.5 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>导入恢复 (JSON)</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportData}
                className="hidden"
              />
            </label>
          </div>

          <div className="pt-2">
            <button
              onClick={handleResetData}
              className="w-full py-2 text-slate-600 hover:text-rose-600 text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重置为初始演示数据</span>
            </button>
          </div>
        </div>
      </div>

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
