import { StorageService } from './storage';

export const SPEECH_MODES = {
  NATURAL: 'natural',
  CLOUD: 'cloud',
  SYSTEM: 'system',
};

const CLOUD_CACHE_NAME = 'lingoflow-tts-v1';
const MAX_CLOUD_TEXT_LENGTH = 4096;

const hashText = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const joinUrl = (baseUrl) => {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (base.endsWith('/audio/speech')) return base;
  return `${base}${base.endsWith('/v1') ? '' : '/v1'}/audio/speech`;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));

/**
 * Hybrid text-to-speech service.
 *
 * New Concept lesson playback continues to use its original audio element and
 * can opt into the system fallback with channel: 'course'. All other content
 * defaults to a higher-quality browser voice and can optionally use an
 * OpenAI-compatible neural TTS endpoint configured by the user.
 */
class TTSService {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = [];
    this.preferredVoice = null;
    this.activeAudio = null;
    this.activeAudioUrl = '';
    this.activeResolve = null;
    this.activeRequestController = null;
    this.playToken = 0;

    if (this.synth) {
      this.loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.loadVoices();
      }
    }
  }

  loadVoices() {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
    this.pickBestVoice();
  }

  getVoiceQuality(voice) {
    const name = String(voice?.name || '').toLowerCase();
    if (/(natural|neural|online|wavenet|chirp|studio)/.test(name)) return 'natural';
    if (/(premium|enhanced|high quality|hq)/.test(name)) return 'enhanced';
    return 'standard';
  }

  getVoiceQualityLabel(voice) {
    const quality = this.getVoiceQuality(voice);
    if (quality === 'natural') return '自然';
    if (quality === 'enhanced') return '增强';
    return '系统';
  }

  getAvailableFemaleVoices() {
    if (!this.voices || this.voices.length === 0) {
      if (this.synth) this.voices = this.synth.getVoices();
    }
    if (!this.voices) return [];

    const maleKeywords = [
      'daniel', 'david', 'george', 'oliver', 'guy', 'mark',
      'james', 'john', 'tom', 'male', 'richard', 'steve', 'fred',
    ];

    return this.voices
      .filter((voice) => String(voice.lang || '').toLowerCase().startsWith('en'))
      .filter((voice) => {
        const nameLower = String(voice.name || '').toLowerCase();
        return !maleKeywords.some((keyword) => nameLower.includes(keyword));
      })
      .sort((a, b) => this.scoreVoice(b) - this.scoreVoice(a));
  }

  scoreVoice(voice) {
    const name = String(voice?.name || '').toLowerCase();
    const quality = this.getVoiceQuality(voice);
    const qualityScore = quality === 'natural' ? 500 : quality === 'enhanced' ? 300 : 0;
    const nameScore =
      (name.includes('ava') ? 80 : 0) +
      (name.includes('samantha') ? 75 : 0) +
      (name.includes('jenny') || name.includes('aria') ? 70 : 0) +
      (name.includes('serena') ? 60 : 0) +
      (name.includes('online') ? 35 : 0) +
      (name.includes('premium') || name.includes('enhanced') ? 30 : 0);
    const defaultScore = voice?.default ? 8 : 0;
    const localScore = voice?.localService ? 0 : 5;
    return qualityScore + nameScore + defaultScore + localScore;
  }

  pickBestVoice(accent = 'en-US', specifiedURI = '', options = {}) {
    if (!this.voices || this.voices.length === 0) {
      if (this.synth) this.voices = this.synth.getVoices();
    }
    if (!this.voices || this.voices.length === 0) return null;

    if (specifiedURI) {
      const match = this.voices.find((voice) => voice.voiceURI === specifiedURI);
      if (match) {
        this.preferredVoice = match;
        return match;
      }
    }

    const accentPrefix = String(accent || 'en-US').slice(0, 2).toLowerCase();
    const englishVoices = this.voices.filter((voice) => String(voice.lang || '').toLowerCase().startsWith('en'));

    if (options.systemDefault) {
      const systemVoice = englishVoices.find((voice) => voice.default && voice.lang.toLowerCase().startsWith(accentPrefix));
      const accentVoice = englishVoices.find((voice) => voice.lang.toLowerCase().startsWith(accentPrefix));
      const fallback = systemVoice || accentVoice || englishVoices[0] || this.voices[0];
      this.preferredVoice = fallback;
      return fallback;
    }

    const femaleVoices = this.getAvailableFemaleVoices();
    const matched = femaleVoices.find((voice) => voice.lang.toLowerCase().startsWith(accentPrefix));
    const best = matched || femaleVoices[0] || englishVoices[0] || this.voices[0];
    this.preferredVoice = best;
    return best;
  }

  getSpeechStatus(settings = StorageService.getSettings()) {
    const englishVoices = (this.voices || []).filter((voice) => String(voice.lang || '').toLowerCase().startsWith('en'));
    const femaleVoices = this.getAvailableFemaleVoices();
    return {
      browserSupported: this.isSupported(),
      englishVoiceCount: englishVoices.length,
      naturalVoiceCount: femaleVoices.filter((voice) => this.getVoiceQuality(voice) === 'natural').length,
      enhancedVoiceCount: femaleVoices.filter((voice) => this.getVoiceQuality(voice) === 'enhanced').length,
      cloudConfigured: Boolean(settings.speechApiKey?.trim() && settings.speechBaseUrl?.trim()),
      mode: settings.speechMode || SPEECH_MODES.NATURAL,
    };
  }

  canUseCloud(settings) {
    return Boolean(settings.speechApiKey?.trim() && settings.speechBaseUrl?.trim());
  }

  async readCachedAudio(cacheKey) {
    if (typeof window === 'undefined' || !('caches' in window)) return null;
    try {
      const cache = await window.caches.open(CLOUD_CACHE_NAME);
      const response = await cache.match(cacheKey);
      return response ? response.blob() : null;
    } catch {
      return null;
    }
  }

  async writeCachedAudio(cacheKey, blob) {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    try {
      const cache = await window.caches.open(CLOUD_CACHE_NAME);
      await cache.put(cacheKey, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));
    } catch {
      // Caching is an enhancement; speech should continue if storage is full.
    }
  }

  async playAudioBlob(blob, token) {
    if (typeof Audio === 'undefined' || token !== this.playToken) return false;
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    this.activeAudio = audio;
    this.activeAudioUrl = audioUrl;

    return new Promise((resolve) => {
      const finish = (played) => {
        if (this.activeAudio !== audio) return;
        this.activeAudio = null;
        this.activeAudioUrl = '';
        URL.revokeObjectURL(audioUrl);
        if (this.activeResolve === resolve) this.activeResolve = null;
        resolve(played);
      };
      this.activeResolve = resolve;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }

  async speakCloud(text, settings, token) {
    if (!this.canUseCloud(settings) || token !== this.playToken) return false;

    const cleanText = text.trim().slice(0, MAX_CLOUD_TEXT_LENGTH);
    const model = settings.speechModel || 'gpt-4o-mini-tts';
    const voice = settings.speechVoice || 'coral';
    const speed = clamp(settings.voiceRate || 0.95, 0.25, 4);
    const cacheKey = typeof window !== 'undefined'
      ? `${window.location.origin}/__lingoflow_tts__/${hashText(`${settings.speechBaseUrl}|${model}|${voice}|${speed}|${settings.speechInstructions || ''}|${cleanText}`)}`
      : `https://lingoflow.local/__lingoflow_tts__/${hashText(`${settings.speechBaseUrl}|${model}|${voice}|${speed}|${settings.speechInstructions || ''}|${cleanText}`)}`;

    try {
      let blob = await this.readCachedAudio(cacheKey);
      if (!blob) {
        const controller = new AbortController();
        this.activeRequestController = controller;
        const body = {
          model,
          input: cleanText,
          voice,
          response_format: 'mp3',
          speed,
        };
        if (settings.speechInstructions?.trim() && !['tts-1', 'tts-1-hd'].includes(model)) {
          body.instructions = settings.speechInstructions.trim();
        }

        const response = await fetch(joinUrl(settings.speechBaseUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.speechApiKey.trim()}`,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`自然语音接口返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}`);
        }
        blob = await response.blob();
        await this.writeCachedAudio(cacheKey, blob);
      }
      if (this.activeRequestController?.signal.aborted || token !== this.playToken) return false;
      return this.playAudioBlob(blob, token);
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('Cloud TTS unavailable, falling back to browser voice:', error);
      return false;
    } finally {
      this.activeRequestController = null;
    }
  }

  speakBrowser(text, options, mode, token) {
    if (!this.synth || typeof window.SpeechSynthesisUtterance === 'undefined' || token !== this.playToken) {
      console.warn('SpeechSynthesis not supported on this device');
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      if (!text || !text.trim()) {
        resolve(true);
        return;
      }

      const settings = StorageService.getSettings();
      const utterance = new SpeechSynthesisUtterance(text.trim());
      const systemDefault = mode === SPEECH_MODES.SYSTEM;
      const voice = this.pickBestVoice(
        options.accent || settings.voiceAccent || 'en-US',
        options.voiceURI || settings.preferredVoiceURI,
        { systemDefault }
      );
      if (voice) utterance.voice = voice;
      utterance.lang = voice ? voice.lang : (options.accent || settings.voiceAccent || 'en-US');
      utterance.rate = options.rate !== undefined ? options.rate : (settings.voiceRate || 0.95);
      utterance.pitch = options.pitch !== undefined ? options.pitch : (settings.voicePitch || 1.05);

      const finish = () => {
        if (this.activeResolve === resolve) this.activeResolve = null;
        resolve(true);
      };
      this.activeResolve = resolve;
      utterance.onend = finish;
      utterance.onerror = (error) => {
        console.warn('TTS utterance error:', error);
        finish();
      };
      this.synth.speak(utterance);
    });
  }

  speak(text, options = {}) {
    if (!text || !text.trim()) return Promise.resolve(true);

    const settings = StorageService.getSettings();
    const mode = options.mode || (options.channel === 'course' ? SPEECH_MODES.SYSTEM : settings.speechMode) || SPEECH_MODES.NATURAL;
    this.stop();
    const token = this.playToken;

    if (mode === SPEECH_MODES.CLOUD && options.channel !== 'course' && this.canUseCloud(settings)) {
      return this.speakCloud(text, settings, token).then((played) => {
        if (played || token !== this.playToken) return played;
        return this.speakBrowser(text, options, SPEECH_MODES.NATURAL, token);
      });
    }

    return this.speakBrowser(text, options, mode, token);
  }

  stop() {
    this.playToken += 1;
    if (this.activeRequestController) {
      this.activeRequestController.abort();
      this.activeRequestController = null;
    }
    if (this.synth) this.synth.cancel();
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
      this.activeAudio = null;
    }
    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = '';
    }
    if (this.activeResolve) {
      const resolve = this.activeResolve;
      this.activeResolve = null;
      resolve(false);
    }
  }

  pause() {
    if (this.activeAudio) {
      this.activeAudio.pause();
    } else if (this.synth && this.synth.speaking) {
      this.synth.pause();
    }
  }

  resume() {
    if (this.activeAudio) {
      this.activeAudio.play().catch(() => {});
    } else if (this.synth && this.synth.paused) {
      this.synth.resume();
    }
  }

  isSupported() {
    const browserSupported = Boolean(
      this.synth && typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'
    );
    const cloudSupported = Boolean(
      typeof Audio !== 'undefined' &&
      typeof window !== 'undefined' &&
      'fetch' in window &&
      this.canUseCloud(StorageService.getSettings())
    );
    return Boolean(
      browserSupported || cloudSupported
    );
  }

  isSpeaking() {
    return Boolean((this.activeAudio && !this.activeAudio.paused && !this.activeAudio.ended) || (this.synth && this.synth.speaking));
  }
}

export const tts = new TTSService();

/**
 * Speech to Text (STT) Service using Web Speech API
 */
class STTService {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.initRecognition();
  }

  initRecognition() {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'en-US'; // English practice
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
    }
  }

  isSupported() {
    return !!(
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }

  startListening({ onResult, onEnd, onError, onStart }) {
    if (!this.recognition) {
      this.initRecognition();
    }

    if (!this.recognition) {
      if (onError) onError(new Error('当前浏览器不支持麦克风语音识别，建议使用系统输入法的语音输入'));
      return;
    }

    if (this.isListening) {
      this.stop();
    }

    this.recognition.onstart = () => {
      this.isListening = true;
      if (onStart) onStart();
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (onResult) {
        onResult({
          text: finalTranscript || interimTranscript,
          isFinal: Boolean(finalTranscript),
        });
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('STT Error event:', event.error);
      this.isListening = false;
      if (onError) onError(event);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (onEnd) onEnd();
    };

    try {
      this.recognition.start();
    } catch (err) {
      console.warn('Failed to start speech recognition:', err);
      this.isListening = false;
      if (onError) onError(err);
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.isListening = false;
    }
  }
}

export const stt = new STTService();
