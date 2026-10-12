/**
 * Efectos del sorteo en vivo: suspenso de la tómbola, redoble de tambor y confeti.
 * El redoble y el platillo son grabaciones reales de dominio público (ver README); al final suenan aplausos, o el
 * sonido de perdedor si el número se fue al agua. Si las grabaciones no cargan, se sintetizan.
 * Todo es opcional y se degrada en silencio: sin Web Audio no suena, sin canvas no hay confeti.
 */
import applauseUrl from './sonidos/aplausos.mp3?url';
import loserUrl from './sonidos/perdedor.mp3?url';
import crashUrl from './sonidos/platillo.mp3?url';
import rollUrl from './sonidos/redoble.mp3?url';

/** Pausas entre números mientras la tómbola frena: de rápido a lento (curva cúbica), unos 4 segundos en total */
export function suspenseDelays(steps = 24, from = 55, to = 560): number[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 1 : i / (steps - 1);
    return Math.round(from + (to - from) * t * t * t);
  });
}

// ---------------------------------------------------------------------------------------------
// Sonido: redoble de tambor (caja) que crece mientras la tómbola frena, y golpe final con platillo

export interface DrawSound {
  /** Arranca el redoble (suave) */
  start(): void;
  /** progress 0→1: el redoble crece en volumen y velocidad a medida que la tómbola frena */
  tick(progress: number): void;
  /**
   * Corta el redoble con el final: para un ganador, golpe con platillo y aplausos; para un número al agua,
   * un bombo suave y el sonido de perdedor
   */
  reveal(kind?: 'premio' | 'agua'): void;
  /** Silencia o reactiva al instante (sin cortar el sorteo) */
  setMuted(muted: boolean): void;
  /** Detiene todo y libera el audio */
  stop(): void;
}

const SILENT: DrawSound = { start() {}, tick() {}, reveal() {}, setMuted() {}, stop() {} };

type AudioCtor = typeof AudioContext;

const VOLUME = 0.75;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface DrumKit {
  /** Golpe de caja: chasquido de la bordona (ruido filtrado) + cuerpo del parche (tono que cae) */
  snare(when: number, velocity: number): void;
  /** Bombo: tono grave que cae */
  kick(when: number, velocity: number): void;
  /** Platillo: ruido agudo con caída larga */
  crash(when: number, velocity: number): void;
  /** Chapuzón: dos "glup" (tono que sube rápido, como una gota) y el salpicón (ruido filtrado corto) */
  splash(when: number, velocity: number): void;
  tone(freq: number, when: number, dur: number, volume: number, type?: OscillatorType): void;
}

/** Percusión sintetizada sobre cualquier contexto de audio (en vivo, o fuera de línea para medirla). */
export function createDrumKit(ctx: BaseAudioContext, out: AudioNode): DrumKit {
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noiseFrom = (when: number, dur: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.start(when, Math.random() * 0.4);
    src.stop(when + dur);
    return src;
  };
  const envelope = (when: number, peak: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    return g;
  };

  return {
    snare(when, velocity) {
      const v = clamp01(velocity);
      const wires = noiseFrom(when, 0.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 8000;
      const wg = envelope(when, v * 0.9, 0.12);
      wires.connect(hp);
      hp.connect(lp);
      lp.connect(wg);
      wg.connect(out);

      const head = ctx.createOscillator();
      head.type = 'triangle';
      head.frequency.setValueAtTime(240, when);
      head.frequency.exponentialRampToValueAtTime(150, when + 0.05);
      const hg = envelope(when, v * 0.45, 0.07);
      head.connect(hg);
      hg.connect(out);
      head.start(when);
      head.stop(when + 0.1);
    },
    kick(when, velocity) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(42, when + 0.3);
      const g = envelope(when, clamp01(velocity), 0.5);
      o.connect(g);
      g.connect(out);
      o.start(when);
      o.stop(when + 0.55);
    },
    crash(when, velocity) {
      const src = noiseFrom(when, 2.4);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3800;
      const g = envelope(when, clamp01(velocity), 2.2);
      src.connect(hp);
      hp.connect(g);
      g.connect(out);
    },
    splash(when, velocity) {
      const v = clamp01(velocity);
      const bloop = (at: number, from: number, to: number, peak: number, decay: number) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(from, at);
        o.frequency.exponentialRampToValueAtTime(to, at + 0.08);
        const g = envelope(at, peak, decay);
        o.connect(g);
        g.connect(out);
        o.start(at);
        o.stop(at + decay + 0.05);
      };
      bloop(when, 260, 950, v * 0.6, 0.16);
      bloop(when + 0.1, 380, 1300, v * 0.35, 0.12);
      const src = noiseFrom(when, 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      const g = envelope(when, v * 0.5, 0.4);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
    },
    tone(freq, when, dur, volume, type = 'triangle') {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(volume, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g);
      g.connect(out);
      o.start(when);
      o.stop(when + dur + 0.05);
    },
  };
}

/** Golpes por segundo y volumen del redoble según la intensidad (0 = suave y más lento, 1 = fuerte y apretado) */
export const rollRate = (intensity: number) => 15 + 9 * clamp01(intensity);
export const rollVelocity = (intensity: number) => 0.16 + 0.64 * clamp01(intensity);

/**
 * Programa los golpes de un redoble entre `from` y `to` (segundos del contexto), alternando manos (la izquierda
 * un poco más suave) con pequeñas imprecisiones humanas. Devuelve dónde sigue el redoble para continuarlo sin cortes.
 */
export function scheduleRoll(
  kit: Pick<DrumKit, 'snare'>,
  from: number,
  to: number,
  intensityAt: (t: number) => number,
  hand = 0,
): { next: number; hand: number } {
  let t = from;
  let h = hand;
  while (t < to) {
    const k = clamp01(intensityAt(t));
    const accent = h % 2 ? 0.86 : 1;
    kit.snare(t + (Math.random() - 0.5) * 0.004, rollVelocity(k) * accent * (0.92 + Math.random() * 0.16));
    h++;
    t += 1 / rollRate(k);
  }
  return { next: t, hand: h };
}

/** Fanfarria corta de celebración: arpegio de do mayor y el acorde sostenido */
export function scheduleFanfare(kit: Pick<DrumKit, 'tone'>, when: number) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => kit.tone(f, when + 0.35 + i * 0.1, 0.25, 0.1));
  notes.forEach((f) => kit.tone(f, when + 0.8, 1.4, 0.06));
}

/** Golpe final del redoble sintetizado: bombo y caja juntos, platillo y la fanfarria */
export function scheduleFinale(kit: DrumKit, when: number) {
  // Fuerte pero sin saturar: medido con renders fuera de línea (pico 0,87–0,94 con el volumen general)
  kit.kick(when, 0.75);
  kit.snare(when, 0.8);
  kit.crash(when, 0.42);
  scheduleFanfare(kit, when);
}

/** Final de un número al agua: el redoble se corta con un bombo suave y el número cae al agua */
export function scheduleSplash(kit: Pick<DrumKit, 'kick' | 'splash'>, when: number) {
  kit.kick(when, 0.4);
  kit.splash(when + 0.05, 0.9);
}

// ---------------------------------------------------------------------------------------------
// Grabaciones: redoble y platillo reales (dominio público), y los sonidos que eligió el organizador para el final:
// aplausos cuando sale el ganador y el de "perdedor" cuando un número se va al agua

export interface DrumSamples {
  /** Redoble listo para repetirse en bucle sin que se note la unión */
  roll: AudioBuffer;
  crash: AudioBuffer;
  /** Opcionales: si no cargan, suenan la fanfarria o el chapuzón sintetizados */
  applause: AudioBuffer | null;
  loser: AudioBuffer | null;
}

/**
 * Convierte un tramo de redoble en un bucle sin costura: el final se funde con el principio (fundido de igual
 * potencia, ambos tramos suenan parejo). Se descartan unos milisegundos en los bordes porque el decodificador de
 * MP3 puede agregar silencio ahí; como el bucle se arma después de decodificar, la unión queda exacta igual.
 */
export function makeSeamlessLoop(ctx: BaseAudioContext, src: AudioBuffer, margin = 0.1, fade = 0.3): AudioBuffer {
  const s = Math.round(margin * src.sampleRate);
  const x = Math.round(fade * src.sampleRate);
  const len = src.length - 2 * s - x;
  if (len <= 2 * x) throw new Error('El tramo de redoble es muy corto para repetirlo');
  const out = ctx.createBuffer(src.numberOfChannels, len, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const d = src.getChannelData(ch);
    const o = out.getChannelData(ch);
    for (let i = 0; i < len; i++) o[i] = d[s + i];
    // El bucle salta de o[len-1] = d[s+len-1] a o[0]: o[0] arranca como la continuación d[s+len] y se funde hacia d[s]
    for (let i = 0; i < x; i++) {
      const a = ((i + 0.5) / x) * (Math.PI / 2);
      o[i] = d[s + i] * Math.sin(a) + d[s + len + i] * Math.cos(a);
    }
  }
  return out;
}

/** Volumen del redoble grabado según la tensión: empieza piano y crece (≈ ×4) hasta el golpe final */
export const sampledRollGain = (tension: number) => 0.24 + 0.76 * clamp01(tension) ** 1.3;
/** El redoble se aprieta un poco hacia el final (sube 6 % la velocidad y el tono) */
export const sampledRollRate = (tension: number) => 1 + 0.06 * clamp01(tension);
const CRASH_GAIN = 0.85;
const APPLAUSE_GAIN = 1;
const LOSER_GAIN = 0.9;

interface SampleBytes {
  roll: ArrayBuffer;
  crash: ArrayBuffer;
  applause: ArrayBuffer | null;
  loser: ArrayBuffer | null;
}
let sampleBytes: Promise<SampleBytes | null> | null = null;

/** Descarga las grabaciones una sola vez (≈ 330 KB). Sin Web Audio no hace nada. */
export function preloadDrawSounds(): Promise<SampleBytes | null> {
  if (typeof window === 'undefined' || !(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)) {
    return Promise.resolve(null);
  }
  if (!sampleBytes) {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
    // Aplausos y perdedor son opcionales: si fallan, el redoble y el platillo suenan igual
    const optional = (url: string) => get(url).catch(() => null);
    sampleBytes = Promise.all([get(rollUrl), get(crashUrl), optional(applauseUrl), optional(loserUrl)])
      .then(([roll, crash, applause, loser]) => ({ roll, crash, applause, loser }))
      .catch(() => {
        sampleBytes = null; // el próximo sorteo lo vuelve a intentar
        return null;
      });
  }
  return sampleBytes;
}

/** Decodifica las grabaciones para este contexto de audio; null si no se pudieron descargar o decodificar */
export async function loadDrumSamples(ctx: BaseAudioContext): Promise<DrumSamples | null> {
  const bytes = await preloadDrawSounds();
  if (!bytes) return null;
  // decodeAudioData se queda con el ArrayBuffer: se le pasa una copia para poder reusar la descarga
  const decode = (b: ArrayBuffer) => ctx.decodeAudioData(b.slice(0));
  const optional = (b: ArrayBuffer | null) => (b ? decode(b).catch(() => null) : Promise.resolve(null));
  try {
    const [roll, crash, applause, loser] = await Promise.all([decode(bytes.roll), decode(bytes.crash), optional(bytes.applause), optional(bytes.loser)]);
    return { roll: makeSeamlessLoop(ctx, roll), crash, applause, loser };
  } catch {
    return null;
  }
}

/** Reproduce una grabación una vez, con su volumen */
export function playSample(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, when: number, gain: number) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(out);
  src.start(when);
}

/** Redoble grabado en bucle, con volumen y velocidad que siguen la tensión */
export function playSampledRoll(ctx: BaseAudioContext, out: AudioNode, samples: DrumSamples, when: number) {
  const src = ctx.createBufferSource();
  src.buffer = samples.roll;
  src.loop = true;
  src.playbackRate.value = sampledRollRate(0);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  // Entra suave, como un redoble que empieza piano
  g.gain.setTargetAtTime(sampledRollGain(0), when, 0.12);
  src.connect(g);
  g.connect(out);
  // Empieza en un punto al azar del bucle: cada sorteo suena un poco distinto
  src.start(when, Math.random() * samples.roll.duration);
  return {
    setTension(tension: number, at: number) {
      g.gain.setTargetAtTime(sampledRollGain(tension), at, 0.08);
      src.playbackRate.setTargetAtTime(sampledRollRate(tension), at, 0.2);
    },
    /** El redoble se corta justo cuando entra el golpe final (que lo tapa) */
    end(at: number) {
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(0, at, 0.03);
      src.stop(at + 0.4);
    },
  };
}

/** Golpe final con grabaciones: platillo real con el bombo debajo, y los aplausos (o la fanfarria si no cargaron) */
export function playSampledFinale(ctx: BaseAudioContext, out: AudioNode, kit: DrumKit, samples: DrumSamples, when: number) {
  playSample(ctx, out, samples.crash, when, CRASH_GAIN);
  kit.kick(when, 0.7);
  if (samples.applause) playSample(ctx, out, samples.applause, when + 0.05, APPLAUSE_GAIN);
  else scheduleFanfare(kit, when);
}

/** Final de un número al agua: bombo suave y el sonido de perdedor (o el chapuzón sintetizado si no cargó) */
export function playWaterFinale(ctx: BaseAudioContext, out: AudioNode, kit: DrumKit, samples: DrumSamples | null, when: number) {
  if (!samples?.loser) return scheduleSplash(kit, when);
  kit.kick(when, 0.4);
  playSample(ctx, out, samples.loser, when + 0.05, LOSER_GAIN);
}

/** Si las grabaciones tardan más que esto (conexión lenta), el sorteo usa el redoble sintetizado */
const SAMPLE_WAIT_MS = 1200;

/**
 * Crea el sonido del sorteo. Se llama dentro del clic del usuario para que el navegador permita reproducir audio.
 * Con muted=true se prepara igual (en silencio) para poder activarlo a mitad del sorteo.
 * Usa las grabaciones reales; si no cargan a tiempo (sin conexión, error), cae al redoble sintetizado.
 */
export function createDrawSound(muted: boolean): DrawSound {
  const AC: AudioCtor | undefined =
    typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!AC) return SILENT;

  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return SILENT;
  }
  void ctx.resume?.();
  // Compresor: el crescendo y el golpe final suenan fuertes sin saturar
  const comp = ctx.createDynamicsCompressor();
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(comp);
  const kit = createDrumKit(ctx, master);

  let samples: DrumSamples | null = null;
  const loading = loadDrumSamples(ctx).then((s) => (samples = s));

  let tension = 0;
  let next = 0;
  let hand = 0;
  let pump: ReturnType<typeof setInterval> | undefined;
  let roll: ReturnType<typeof playSampledRoll> | undefined;
  let started = false;
  let revealed = false;
  let closed = false;

  // Programador con anticipación: cada 25 ms deja listos los golpes de los próximos 120 ms (el ritmo no tropieza
  // aunque el navegador esté ocupado dibujando)
  const fill = () => {
    ({ next, hand } = scheduleRoll(kit, Math.max(next, ctx.currentTime + 0.01), ctx.currentTime + 0.12, () => tension, hand));
  };
  const startSynth = () => {
    next = ctx.currentTime + 0.03;
    fill();
    pump = setInterval(fill, 25);
  };

  return {
    start() {
      if (closed || started) return;
      started = true;
      tension = 0;
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), SAMPLE_WAIT_MS));
      void Promise.race([loading, timeout]).then((s) => {
        if (closed || revealed) return;
        if (s) {
          roll = playSampledRoll(ctx, master, s, ctx.currentTime + 0.02);
          roll.setTension(tension, ctx.currentTime + 0.02);
        } else startSynth();
      });
    },
    tick(progress) {
      tension = clamp01(progress);
      roll?.setTension(tension, ctx.currentTime);
    },
    reveal(kind = 'premio') {
      if (closed || revealed) return;
      revealed = true;
      let when = ctx.currentTime + 0.02;
      const synth = Boolean(pump);
      if (pump) {
        clearInterval(pump);
        pump = undefined;
        // El redoble ya programado suena hasta el golpe final, sin silencio entre medio
        when = Math.max(next, when);
      }
      roll?.end(when);
      if (kind === 'agua') playWaterFinale(ctx, master, kit, samples, when);
      else if (samples && !synth) playSampledFinale(ctx, master, kit, samples, when);
      else scheduleFinale(kit, when);
    },
    setMuted(m) {
      if (closed) return;
      master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.03);
    },
    stop() {
      if (closed) return;
      closed = true;
      if (pump) clearInterval(pump);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => void ctx.close?.(), 3000);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Confeti

/** Lanza confeti a pantalla completa con los colores de la app. Devuelve una función para cortarlo antes. */
export function launchConfetti(durationMs = 4000): () => void {
  if (typeof document === 'undefined') return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const g = canvas.getContext?.('2d');
  if (!g) return () => {};
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
  };
  resize();
  window.addEventListener('resize', resize);

  const css = getComputedStyle(document.documentElement);
  const colors = ['--primary', '--accent', '--warn-line', '--ok', '--primary-strong']
    .map((v) => css.getPropertyValue(v).trim())
    .filter(Boolean);
  if (!colors.length) colors.push('#0b6178', '#c2410c', '#d9a63a');

  const W = () => canvas.width;
  const H = () => canvas.height;
  type P = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string; wobble: number };
  const parts: P[] = [];
  const burst = (x: number, y: number, n: number, dir: number) => {
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + dir * (0.25 + Math.random() * 0.55);
      const speed = (9 + Math.random() * 10) * dpr;
      parts.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: (6 + Math.random() * 6) * dpr,
        h: (9 + Math.random() * 8) * dpr,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        wobble: Math.random() * Math.PI * 2,
      });
    }
  };
  // Dos cañones desde las esquinas inferiores y una lluvia desde arriba
  burst(0, H(), 70, 1);
  burst(W(), H(), 70, -1);
  for (let i = 0; i < 60; i++) {
    parts.push({
      x: Math.random() * W(),
      y: -Math.random() * H() * 0.3,
      vx: (Math.random() - 0.5) * 2 * dpr,
      vy: (2 + Math.random() * 3) * dpr,
      w: (6 + Math.random() * 6) * dpr,
      h: (9 + Math.random() * 8) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      wobble: Math.random() * Math.PI * 2,
    });
  }

  const start = performance.now();
  let raf = 0;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
  const frame = (now: number) => {
    const elapsed = now - start;
    if (elapsed > durationMs) return cleanup();
    const fade = Math.min(1, (durationMs - elapsed) / (durationMs * 0.25));
    g.clearRect(0, 0, W(), H());
    for (const p of parts) {
      p.vy += 0.32 * dpr;
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.wobble += 0.12;
      p.x += p.vx + Math.sin(p.wobble) * dpr;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.globalAlpha = fade;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      // Achatado según el giro: parece un papel que da vueltas
      g.fillRect(-p.w / 2, (-p.h / 2) * Math.abs(Math.cos(p.wobble)), p.w, p.h * Math.abs(Math.cos(p.wobble)));
      g.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return cleanup;
}
