import { StorageService } from './storage';

/**
 * Text to Speech (TTS) Service using Web Speech API
 */
class TTSService {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = [];
    this.preferredVoice = null;

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

  getAvailableFemaleVoices() {
    if (!this.voices || this.voices.length === 0) {
      if (this.synth) this.voices = this.synth.getVoices();
    }
    if (!this.voices) return [];

    const maleKeywords = [
      'daniel', 'david', 'george', 'oliver', 'guy', 'mark',
      'james', 'john', 'tom', 'male', 'richard', 'steve', 'fred'
    ];

    return this.voices
      .filter((v) => v.lang.startsWith('en'))
      .filter((v) => {
        const nameLower = v.name.toLowerCase();
        return !maleKeywords.some((m) => nameLower.includes(m));
      })
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        // Priority for premium iOS voices (Ava & Samantha) and modern Natural voices (Jenny/Aria)
        const getScore = (name) =>
          (name.includes('ava') ? 100 : 0) +
          (name.includes('samantha') ? 80 : 0) +
          (name.includes('jenny') || name.includes('aria') ? 70 : 0) +
          (name.includes('serena') ? 60 : 0) +
          (name.includes('enhanced') || name.includes('premium') ? 40 : 0) +
          (name.includes('natural') ? 30 : 0);
        return getScore(bName) - getScore(aName);
      });
  }

  pickBestVoice(accent = 'en-US', specifiedURI = '') {
    if (!this.voices || this.voices.length === 0) {
      if (this.synth) this.voices = this.synth.getVoices();
    }
    if (!this.voices || this.voices.length === 0) return null;

    // 1. If user explicitly selected a voice in settings, use it
    if (specifiedURI) {
      const match = this.voices.find((v) => v.voiceURI === specifiedURI);
      if (match) {
        this.preferredVoice = match;
        return match;
      }
    }

    // 2. Prioritize high-quality female voices (especially Ava / Samantha on iOS)
    const femaleVoices = this.getAvailableFemaleVoices();
    if (femaleVoices.length > 0) {
      const accentPrefix = accent.slice(0, 2);
      const matched = femaleVoices.find((v) => v.lang.startsWith(accentPrefix));
      const best = matched || femaleVoices[0];
      this.preferredVoice = best;
      return best;
    }

    // Fallback: any English voice
    const fallback = this.voices.find((v) => v.lang.startsWith('en')) || this.voices[0];
    this.preferredVoice = fallback;
    return fallback;
  }

  speak(text, options = {}) {
    if (!this.synth) {
      console.warn('SpeechSynthesis not supported on this device');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.synth.cancel();

      if (!text || !text.trim()) {
        resolve();
        return;
      }

      const settings = StorageService.getSettings();
      const utterance = new SpeechSynthesisUtterance(text.trim());

      const voice = this.pickBestVoice(
        options.accent || settings.voiceAccent || 'en-US',
        options.voiceURI || settings.preferredVoiceURI
      );
      if (voice) {
        utterance.voice = voice;
      }
      utterance.lang = voice ? voice.lang : (options.accent || settings.voiceAccent || 'en-US');
      utterance.rate = options.rate !== undefined ? options.rate : (settings.voiceRate || 0.95);
      // Pitch 1.05 gives sweet, clear female tone
      utterance.pitch = options.pitch !== undefined ? options.pitch : (settings.voicePitch || 1.05);

      utterance.onend = () => {
        resolve();
      };

      utterance.onerror = (e) => {
        console.warn('TTS utterance error:', e);
        resolve();
      };

      this.synth.speak(utterance);
    });
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
  }

  isSpeaking() {
    return this.synth ? this.synth.speaking : false;
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
