import type { Season } from "./core/level";
import type { Sound } from "./core/state";

/**
 * A meow is a pitch envelope that rises then falls, two detuned oscillators for
 * the formant, a vibrato LFO, and a lowpass whose cutoff tracks the pitch.
 */
export type Meow = {
  readonly pitch: number;
  readonly rise: number;
  readonly fall: number;
  readonly vibrato: number;
  /** 0 is a clean mew, 1 is a rough throaty one. */
  readonly growl: number;
  readonly gain: number;
};

type MeowBounds = { readonly [K in keyof Meow]: readonly [number, number] };

const CHIRPY: MeowBounds = {
  pitch: [560, 780], rise: [0.05, 0.1], fall: [0.16, 0.26],
  vibrato: [5, 9], growl: [0.05, 0.15], gain: [0.4, 0.5],
};

const STARTLED: MeowBounds = {
  pitch: [820, 960], rise: [0.02, 0.04], fall: [0.11, 0.16],
  vibrato: [10, 14], growl: [0.25, 0.35], gain: [0.5, 0.55],
};

const WAIL: MeowBounds = {
  pitch: [340, 380], rise: [0.15, 0.18], fall: [0.75, 0.9],
  vibrato: [2.5, 3], growl: [0.4, 0.5], gain: [0.6, 0.6],
};

export const MEOWS: Readonly<Partial<Record<Sound, MeowBounds>>> = {
  stomp: CHIRPY,
  hurt: STARTLED,
  death: WAIL,
};

export function randomMeow(bounds: MeowBounds, random = Math.random): Meow {
  const sample = ([min, max]: readonly [number, number]): number => min + (max - min) * random();
  return {
    pitch: sample(bounds.pitch), rise: sample(bounds.rise), fall: sample(bounds.fall),
    vibrato: sample(bounds.vibrato), growl: sample(bounds.growl), gain: sample(bounds.gain),
  };
}

type Note = {
  readonly freq: number;
  readonly bend?: number;
  readonly start: number;
  readonly length: number;
  readonly wave?: OscillatorType;
  readonly gain?: number;
};

const BLIPS: Readonly<Record<string, readonly Note[]>> = {
  jump: [{ freq: 320, bend: 760, start: 0, length: 0.11 }],
  flower: [
    { freq: 988, start: 0, length: 0.07 },
    { freq: 1319, start: 0.06, length: 0.15 },
  ],
  monstera: [
    { freq: 784, start: 0, length: 0.07 },
    { freq: 1175, start: 0.06, length: 0.07 },
    { freq: 1568, start: 0.12, length: 0.22 },
  ],
  checkpoint: [
    { freq: 784, start: 0, length: 0.1 },
    { freq: 1047, start: 0.09, length: 0.1 },
    { freq: 1568, start: 0.18, length: 0.28 },
  ],
  land: [{ freq: 150, bend: 70, start: 0, length: 0.07, wave: "triangle", gain: 0.5 }],
  // Wood giving way: a short knock with a splintery tail above it.
  crate: [
    { freq: 210, bend: 90, start: 0, length: 0.08, wave: "square", gain: 0.55 },
    { freq: 620, bend: 340, start: 0.02, length: 0.09, wave: "triangle", gain: 0.3 },
  ],
  bounce: [{ freq: 300, bend: 900, start: 0, length: 0.14, wave: "sine", gain: 0.6 }],
  // A rising two-tone, so an armed TNT is heard even off screen.
  fuse: [
    { freq: 880, start: 0, length: 0.06 },
    { freq: 1175, start: 0.07, length: 0.1 },
  ],
  life: [
    { freq: 659, start: 0, length: 0.08 },
    { freq: 988, start: 0.08, length: 0.08 },
    { freq: 1319, start: 0.16, length: 0.24 },
  ],
  bossHurt: [
    { freq: 160, bend: 60, start: 0, length: 0.22, wave: "sawtooth", gain: 0.7 },
    { freq: 420, bend: 130, start: 0.04, length: 0.2, wave: "square", gain: 0.4 },
  ],
};

/** Claws on stone: filtered noise, not a tone. */
type Scrape = {
  readonly from: number;
  readonly to: number;
  readonly q: number;
  readonly length: number;
  readonly gain: number;
};

const SCRAPES: Readonly<Record<string, Scrape>> = {
  grip: { from: 2600, to: 1100, q: 3.5, length: 0.14, gain: 0.5 },
  // The three verbs are all air and grit, so they are all filtered noise.
  spin: { from: 900, to: 2800, q: 2.2, length: 0.22, gain: 0.42 },
  slide: { from: 1800, to: 500, q: 1.8, length: 0.3, gain: 0.38 },
  slam: { from: 500, to: 120, q: 1.2, length: 0.18, gain: 0.7 },
  explode: { from: 1400, to: 60, q: 0.9, length: 0.45, gain: 0.95 },
};

const PEAK = 0.22;
/** Exponential ramps cannot touch zero, so the envelope floors just above it. */
const SILENCE = 0.0001;

/** One melody, re-keyed and re-voiced so the year sounds like a single piece. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTATONIC = [0, 2, 4, 7, 9];

type Voice = {
  readonly root: number;
  readonly scale: readonly number[];
  readonly lead: OscillatorType;
  readonly bass: OscillatorType;
  readonly gain: number;
};

const SEASON_VOICE: Readonly<Record<Season, Voice>> = {
  spring: { root: 523.25, scale: MAJOR, lead: "square", bass: "triangle", gain: 0.5 },
  summer: { root: 587.33, scale: MAJOR, lead: "square", bass: "sawtooth", gain: 0.55 },
  autumn: { root: 440.0, scale: MINOR, lead: "triangle", bass: "triangle", gain: 0.5 },
  winter: { root: 659.25, scale: MINOR, lead: "sine", bass: "sine", gain: 0.4 },
  sakura: { root: 523.25, scale: PENTATONIC, lead: "triangle", bass: "triangle", gain: 0.48 },
};

/** Scale degrees, not notes: the same shape works in every key. -1 rests. */
const MELODY = [0, 2, 4, 2, 5, 4, 2, 0, -1, 4, 5, 7, 5, 4, 2, -1];
const BASS = [0, -1, -1, -1, 4, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1];
const BEAT = 0.15;
const LOOKAHEAD = 0.25;

function degreeToFreq(root: number, scale: readonly number[], degree: number): number {
  const octave = Math.floor(degree / scale.length);
  const semitone = scale[((degree % scale.length) + scale.length) % scale.length]! + octave * 12;
  return root * Math.pow(2, semitone / 12);
}

export type Audio = {
  play: (sound: Sound) => void;
  /** Call once per frame with the season under the cat; schedules ahead. */
  music: (season: Season) => void;
};

export function createAudio(): Audio {
  // Declared as playback, like a video: otherwise an iPhone's silent switch mutes the game.
  if (navigator.audioSession) navigator.audioSession.type = "playback";
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // iOS only starts a context from inside a tap or key handler, not from a frame callback.
  const resume = (): void => {
    if (ctx.state !== "running") void ctx.resume();
  };
  for (const type of ["touchend", "click", "keydown"]) window.addEventListener(type, resume, true);

  /** One buffer of white noise, reused by every scrape. */
  let noise: AudioBuffer | null = null;
  const noiseBuffer = (): AudioBuffer => {
    if (noise) return noise;
    const length = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  };

  const playScrape = (scrape: Scrape, at: number): void => {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer();

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = scrape.q;
    filter.frequency.setValueAtTime(scrape.from, at);
    filter.frequency.exponentialRampToValueAtTime(scrape.to, at + scrape.length);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(PEAK * scrape.gain, at);
    gain.gain.exponentialRampToValueAtTime(SILENCE, at + scrape.length);

    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + scrape.length + 0.02);
  };

  const playNote = (note: Note, at: number): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = at + note.start;
    const end = start + note.length;
    const peak = PEAK * (note.gain ?? 1);

    osc.type = note.wave ?? "square";
    osc.frequency.setValueAtTime(note.freq, start);
    if (note.bend !== undefined) osc.frequency.exponentialRampToValueAtTime(note.bend, end);

    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(SILENCE, end);

    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
  };

  const playMeow = (meow: Meow, at: number): void => {
    const peak = meow.pitch * 1.35;
    const apex = at + meow.rise;
    const end = apex + meow.fall;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(meow.pitch * 2, at);
    filter.frequency.linearRampToValueAtTime(peak * 2.4, apex);
    filter.frequency.linearRampToValueAtTime(meow.pitch * 1.1, end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, at);
    gain.gain.exponentialRampToValueAtTime(PEAK * meow.gain, apex);
    gain.gain.exponentialRampToValueAtTime(SILENCE, end);

    // Vibrato drives both oscillators, which is what stops it sounding synthetic.
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = meow.vibrato;
    lfoDepth.gain.value = meow.pitch * 0.04;
    lfo.connect(lfoDepth);

    for (const [detune, wave] of [
      [0, "sawtooth"] as const,
      [meow.growl * 40 + 7, "square"] as const,
    ]) {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(meow.pitch * 0.8, at);
      osc.frequency.linearRampToValueAtTime(peak, apex);
      osc.frequency.linearRampToValueAtTime(meow.pitch * 0.55, end);
      lfoDepth.connect(osc.frequency);
      osc.connect(filter);
      osc.start(at);
      osc.stop(end + 0.05);
    }

    filter.connect(gain).connect(master);
    lfo.start(at);
    lfo.stop(end + 0.05);
  };

  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.3;
  musicBus.connect(master);

  let nextBeat = 0;
  let beatIndex = 0;

  const scheduleBeat = (voice: Voice, at: number, index: number): void => {
    const play = (degree: number, wave: OscillatorType, length: number, level: number) => {
      if (degree < 0) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(degreeToFreq(voice.root, voice.scale, degree), at);
      gain.gain.setValueAtTime(SILENCE, at);
      gain.gain.exponentialRampToValueAtTime(PEAK * level * voice.gain, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(SILENCE, at + length);
      osc.connect(gain).connect(musicBus);
      osc.start(at);
      osc.stop(at + length + 0.02);
    };

    play(MELODY[index % MELODY.length]!, voice.lead, BEAT * 0.9, 0.5);
    play(BASS[index % BASS.length]! - 14, voice.bass, BEAT * 3.2, 0.75);
  };

  return {
    music: (season) => {
      if (ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (nextBeat < now) nextBeat = now + 0.05;
      while (nextBeat < now + LOOKAHEAD) {
        scheduleBeat(SEASON_VOICE[season], nextBeat, beatIndex);
        nextBeat += BEAT;
        beatIndex++;
      }
    },
    play: (sound) => {
      // The context starts suspended until the page has seen a user gesture.
      if (ctx.state === "suspended") void ctx.resume();
      const at = ctx.currentTime;
      const scrape = SCRAPES[sound];
      if (scrape) {
        playScrape(scrape, at);
        return;
      }
      const bounds = MEOWS[sound];
      if (bounds) {
        playMeow(randomMeow(bounds), at);
        return;
      }
      for (const note of BLIPS[sound] ?? []) playNote(note, at);
    },
  };
}
