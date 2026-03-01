/**
 * Web Audio API notification sounds
 * Port of NotificationManager from Notification.html
 */

export function playSound(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    [0, 0.15, 0.3].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = delay < 0.2 ? 880 : 1046.5;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        ctx.currentTime + delay + 0.15,
      );
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.15);
    });
  } catch {
    // Web Audio API not available
  }
}

export function notify(title: string, body: string): void {
  playSound();
  setTimeout(() => {
    alert(`${title}\n${body}`);
  }, 500);
}
