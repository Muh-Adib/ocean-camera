// ---------------------------------------------------------------
// AudioManager — fully procedural cinematic underwater ambience
// (WebAudio, zero assets): deep drone, filtered water noise,
// random bubble blips, distant whale-like calls, soft gesture
// shimmer. Starts only after a user gesture; mute toggle exposed.
// ---------------------------------------------------------------
import { rand } from '../utils/math'

export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private started = false
  private muted = false
  private whaleTimer: ReturnType<typeof setTimeout> | null = null
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null

  get isMuted() { return this.muted }

  /** must be called from a user gesture (click) to satisfy autoplay policy */
  async start() {
    if (this.started) return
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      await this.ctx.resume()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(this.ctx.destination)

      this.buildDrone()
      this.buildNoise()
      this.scheduleBubble()
      this.scheduleWhale()

      // gentle fade in
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime + 4)
      this.started = true
    } catch {
      // audio is optional — stay silent
    }
  }

  setMuted(m: boolean) {
    this.muted = m
    if (!this.ctx || !this.master) return
    this.master.gain.cancelScheduledValues(this.ctx.currentTime)
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.5, this.ctx.currentTime + 0.6)
  }

  // ---------------- layers ----------------
  private buildDrone() {
    const ctx = this.ctx!
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.05
    droneGain.connect(this.master!)

    const o1 = ctx.createOscillator()
    o1.type = 'sine'; o1.frequency.value = 54
    const o2 = ctx.createOscillator()
    o2.type = 'sine'; o2.frequency.value = 81.5   // detuned fifth-ish
    const o3 = ctx.createOscillator()
    o3.type = 'triangle'; o3.frequency.value = 108
    const g3 = ctx.createGain(); g3.gain.value = 0.25

    // slow breathing LFO
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.022
    lfo.connect(lfoGain)
    lfoGain.connect(droneGain.gain)

    o1.connect(droneGain); o2.connect(droneGain)
    o3.connect(g3); g3.connect(droneGain)
    o1.start(); o2.start(); o3.start(); lfo.start()
  }

  private buildNoise() {
    const ctx = this.ctx!
    // brown-ish noise buffer
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.2
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 340
    const g = ctx.createGain()
    g.gain.value = 0.05

    // very slow swell
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.045
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.025
    lfo.connect(lfoG); lfoG.connect(g.gain)

    src.connect(lp); lp.connect(g); g.connect(this.master!)
    src.start(); lfo.start()
  }

  private scheduleBubble() {
    if (this.whaleTimer === undefined) return
    const delay = rand(900, 4200)
    this.bubbleTimer = setTimeout(() => {
      this.blip()
      this.scheduleBubble()
    }, delay)
  }

  private blip() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    const f0 = rand(380, 950)
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f0 * rand(1.3, 2.1), t + rand(0.05, 0.12))
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(rand(0.008, 0.02), t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g); g.connect(this.master!)
    o.start(t); o.stop(t + 0.2)
  }

  private scheduleWhale() {
    this.whaleTimer = setTimeout(() => {
      this.whaleCall()
      this.scheduleWhale()
    }, rand(22000, 55000))
  }

  private whaleCall() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(rand(140, 200), t)
    o.frequency.exponentialRampToValueAtTime(rand(60, 85), t + rand(2.5, 4.5))
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(rand(0.025, 0.05), t + 1.4)
    g.gain.linearRampToValueAtTime(0.0001, t + 5.5)

    // soft echo via delay
    const delay = ctx.createDelay(1.5)
    delay.delayTime.value = 0.45
    const fb = ctx.createGain()
    fb.gain.value = 0.3
    const wet = ctx.createGain()
    wet.gain.value = 0.4
    delay.connect(fb); fb.connect(delay)
    delay.connect(wet); wet.connect(this.master!)

    o.connect(g); g.connect(this.master!); g.connect(delay)
    o.start(t); o.stop(t + 6)
  }

  /** subtle shimmer feedback on strong gestures */
  gestureSpark(strength: number) {
    if (!this.ctx || this.muted || strength < 0.45) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const base = rand(880, 1320)
    ;[0, 1].forEach((i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = base * (1 + i * 0.5)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.012 * strength, t + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.connect(g); g.connect(this.master!)
      o.start(t); o.stop(t + 0.6)
    })
  }

  dispose() {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
    if (this.whaleTimer) clearTimeout(this.whaleTimer)
    this.ctx?.close()
    this.ctx = null
    this.started = false
  }
}
