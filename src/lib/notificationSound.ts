/**
 * Sonido corto (dos tonos ascendentes) para notificaciones nuevas — mismo
 * carácter que el "ding" clásico de Facebook/Messenger, pero sintetizado con
 * Web Audio API: no tenemos el archivo real de Meta ni deberíamos
 * redistribuirlo, así que se genera en el navegador sin depender de ningún
 * asset externo.
 */
let sharedAudioCtx: AudioContext | null = null;

export function playNotificationChime() {
  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    // Un solo contexto reusado — crear uno por notificación satura el audio
    // del navegador y en algunos navegadores dispara la política de
    // "demasiados AudioContext creados sin interacción del usuario".
    if (!sharedAudioCtx) sharedAudioCtx = new AudioContextCtor();
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    // Silencioso — el audio del navegador puede estar bloqueado (autoplay
    // policy) o no soportado; nunca debe romper el polling de notificaciones.
  }
}
