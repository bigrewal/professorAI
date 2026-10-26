let speakToken = 0;

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function canListen() {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const preferred = ["Samantha", "Google UK English Female", "Google US English", "Daniel", "Karen", "Moira"];
  for (const name of preferred) {
    const match = voices.find((voice) => voice.name === name);
    if (match) return match;
  }
  return voices.find((voice) => String(voice.lang || "").toLowerCase().startsWith("en")) || null;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    pickVoice();
  };
}

export function stopSpeaking() {
  speakToken += 1;
  window.speechSynthesis?.cancel();
}

export function speakText(text, { rate = 0.96, onend } = {}) {
  const token = ++speakToken;
  window.speechSynthesis?.cancel();
  if (!canSpeak() || !String(text || "").trim()) {
    onend?.();
    return;
  }

  const parts = String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [text];
  let index = 0;

  const next = () => {
    if (token !== speakToken) return;
    if (index >= parts.length) {
      onend?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(parts[index]);
    index += 1;
    utterance.rate = rate;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = next;
    utterance.onerror = () => {
      if (token === speakToken) onend?.();
    };
    window.speechSynthesis.speak(utterance);
  };

  window.setTimeout(next, 40);
}

export function listenOnce({ onpartial, onresult, onerror }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    onerror?.(new Error("Voice input is not available in this browser."));
    return () => {};
  }

  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  let finalText = "";
  let settled = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const piece = event.results[index][0]?.transcript || "";
      if (event.results[index].isFinal) finalText = `${finalText} ${piece}`.trim();
      else interim = `${interim} ${piece}`.trim();
    }
    onpartial?.(`${finalText} ${interim}`.trim());
  };

  recognition.onerror = (event) => {
    if (settled) return;
    settled = true;
    if (event.error === "aborted" || event.error === "no-speech") {
      onresult?.(finalText.trim());
      return;
    }
    onerror?.(new Error(event.error || "Voice input failed."));
  };

  recognition.onend = () => {
    if (settled) return;
    settled = true;
    onresult?.(finalText.trim());
  };

  recognition.start();
  return () => {
    settled = true;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.stop();
  };
}
