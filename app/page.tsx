'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AudioLines, AudioWaveform, Check, ChevronDown, CircleHelp, Download, Headphones, LoaderCircle, Music2, Pause, Play, Plus, RotateCcw, Upload, Volume2, WandSparkles, Mic2, SlidersHorizontal, Zap } from 'lucide-react'

type Effect = 'tempo' | 'pitch' | 'bass' | 'spatial' | 'bitDepth' | 'vocal' | 'distortion'
type AudioEngine = { context: AudioContext; source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; panner: StereoPannerNode; buffer: AudioBuffer; shaper: WaveShaperNode; crusher: ScriptProcessorNode; splitter: ChannelSplitterNode | null; merger: ChannelMergerNode | null; vocalGain: GainNode | null; dryGain: GainNode | null }

const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState('')
  const [tempo, setTempo] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [bass, setBass] = useState(0)
  const [spatial, setSpatial] = useState(0.5)
  const [bitDepth, setBitDepth] = useState(16)
  const [vocal, setVocal] = useState(0)
  const [distortion, setDistortion] = useState(0)
  const [enabled, setEnabled] = useState<Record<Effect, boolean>>({ tempo: true, pitch: false, bass: true, spatial: true, bitDepth: false, vocal: false, distortion: false })
  const [selectedVibe, setSelectedVibe] = useState('')
  const [showFineTune, setShowFineTune] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [engineReady, setEngineReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const playbackOffsetRef = useRef(0)
  const playbackStartedAtRef = useRef(0)
  const decodedRef = useRef<AudioBuffer | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [waveBars, setWaveBars] = useState<number[]>(Array.from({ length: 96 }, (_, i) => Math.round(12 + Math.abs(Math.sin(i * 12.9898) * Math.cos(i * 4.141)) * 78)))

  const useNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3600) }
  const stopEngine = useCallback(() => {
    const engine = engineRef.current
    if (engine) {
      playbackOffsetRef.current = currentTime
      try { engine.source.stop() } catch {}
      void engine.context.close()
      engineRef.current = null
    }
    setPlaying(false)
  }, [currentTime])

  const makeDistortionCurve = (amount: number) => {
    const samples = 44100
    const curve = new Float32Array(samples)
    const k = amount * 12
    for (let i = 0; i < samples; i++) {
      const x = i * 2 / samples - 1
      curve[i] = (1 + k) * x / (1 + k * Math.abs(x))
    }
    return curve
  }

  const connectVocalReducer = (context: AudioContext | OfflineAudioContext, input: AudioNode, output: AudioNode, amount: number, stereo: boolean) => {
    if (!stereo || amount <= 0) { input.connect(output); return { splitter: null, merger: null, vocalGain: null, dryGain: null } }
    const splitter = context.createChannelSplitter(2)
    const merger = context.createChannelMerger(2)
    const directLeft = context.createGain()
    const directRight = context.createGain()
    const sumGain = context.createGain()
    const midLeft = context.createGain()
    const midRight = context.createGain()
    directLeft.gain.value = 1
    directRight.gain.value = 1
    sumGain.gain.value = -amount / 2
    input.connect(splitter)
    splitter.connect(directLeft, 0); directLeft.connect(merger, 0, 0)
    splitter.connect(directRight, 1); directRight.connect(merger, 0, 1)
    splitter.connect(sumGain, 0); splitter.connect(sumGain, 1)
    sumGain.connect(midLeft); sumGain.connect(midRight)
    midLeft.connect(merger, 0, 0); midRight.connect(merger, 0, 1)
    merger.connect(output)
    return { splitter, merger, vocalGain: sumGain, dryGain: null }
  }

  const reduceBitDepth = (buffer: AudioBuffer, depth: number) => {
    const levels = 2 ** (depth - 1)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel)
      for (let i = 0; i < samples.length; i++) samples[i] = Math.round(samples[i] * levels) / levels
    }
    return buffer
  }

  const processFile = useCallback(async (picked: File) => {
    if (!picked.type.startsWith('audio/')) { useNotice('Choose an audio file such as MP3, WAV, M4A or OGG.'); return }
    stopEngine()
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    const url = URL.createObjectURL(picked)
    setFile(picked); setFileUrl(url); setCurrentTime(0); setDuration(0); decodedRef.current = null; setEngineReady(false)
    try {
      const ctx = new AudioContext()
      const bytes = await picked.arrayBuffer()
      decodedRef.current = await ctx.decodeAudioData(bytes)
      const decoded = decodedRef.current
      setDuration(decoded.duration)
      // Calculate one peak per horizontal slice from all channels. Sampling a
      // bounded number of points keeps large tracks responsive while preserving
      // the real waveform's dynamics and transients.
      const barCount = 96
      const peaks = Array.from({ length: barCount }, (_, bar) => {
        const start = Math.floor(bar * decoded.length / barCount)
        const end = Math.max(start + 1, Math.floor((bar + 1) * decoded.length / barCount))
        const stride = Math.max(1, Math.floor((end - start) / 2048))
        let squareSum = 0
        let count = 0
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const samples = decoded.getChannelData(channel)
          for (let i = start; i < end; i += stride) { squareSum += samples[i] * samples[i]; count++ }
        }
        const rms = count ? Math.sqrt(squareSum / count) : 0
        return Math.max(2, Math.round(Math.pow(rms, 0.65) * 100))
      })
      setWaveBars(peaks)
      await ctx.close()
      setEngineReady(true)
    } catch {
      useNotice('This audio format could not be decoded by your browser. Try an MP3 or WAV file.')
    }
  }, [fileUrl, stopEngine])

  const startPlayback = useCallback(async (offset = currentTime) => {
    if (!file || !decodedRef.current) return
    stopEngine()
    const context = new AudioContext()
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const panner = context.createStereoPanner()
    const gain = context.createGain()
    const shaper = context.createWaveShaper()
    shaper.curve = makeDistortionCurve(enabled.distortion ? distortion : 0)
    shaper.oversample = '4x'
    const crusher = context.createScriptProcessor(4096, decodedRef.current.numberOfChannels, decodedRef.current.numberOfChannels)
    crusher.onaudioprocess = event => {
      const depth = enabled.bitDepth ? bitDepth : 16
      const levels = 2 ** (depth - 1)
      for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel++) {
        const input = event.inputBuffer.getChannelData(channel)
        const output = event.outputBuffer.getChannelData(channel)
        for (let i = 0; i < input.length; i++) output[i] = Math.round(input[i] * levels) / levels
      }
    }
    const vocalNodes = connectVocalReducer(context, panner, gain, enabled.vocal ? vocal : 0, decodedRef.current.numberOfChannels > 1)
    source.buffer = decodedRef.current
    source.playbackRate.value = (enabled.tempo ? tempo : 1) * (enabled.pitch ? 2 ** (pitch / 12) : 1)
    filter.type = 'lowshelf'; filter.frequency.value = 180; filter.gain.value = enabled.bass ? bass : 0
    source.connect(filter); filter.connect(shaper); shaper.connect(crusher); crusher.connect(panner); gain.connect(context.destination)
    const startedAt = context.currentTime
    source.onended = () => { if (engineRef.current?.source === source) { engineRef.current = null; setPlaying(false); setCurrentTime(0) } }
    engineRef.current = { context, source, gain, filter, panner, buffer: decodedRef.current, shaper, crusher, splitter: vocalNodes.splitter, merger: vocalNodes.merger, vocalGain: vocalNodes.vocalGain, dryGain: vocalNodes.dryGain }
    await context.resume(); source.start(0, Math.min(offset, decodedRef.current.duration - 0.01)); setPlaying(true)
    playbackOffsetRef.current = offset
    playbackStartedAtRef.current = context.currentTime
    const tick = () => {
      if (engineRef.current?.source !== source) return
      // Track time is source time. AudioBufferSourceNode advances through the
      // source by playbackRate, so this keeps the marker/time labels truthful.
      const trackTime = offset + (context.currentTime - startedAt) * source.playbackRate.value
      setCurrentTime(Math.min(trackTime, decodedRef.current?.duration ?? 0))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [file, currentTime, stopEngine, enabled, tempo, pitch, bass, bitDepth, vocal, distortion])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.source.playbackRate.value = (enabled.tempo ? tempo : 1) * (enabled.pitch ? 2 ** (pitch / 12) : 1)
    engine.filter.gain.value = enabled.bass ? bass : 0
    engine.shaper.curve = makeDistortionCurve(enabled.distortion ? distortion : 0)
    if (engine.vocalGain) engine.vocalGain.gain.value = 1 - (enabled.vocal ? vocal : 0)
    if (engine.vocalGain) engine.vocalGain.gain.value = enabled.vocal ? -vocal / 2 : 0
  }, [tempo, pitch, bass, distortion, vocal, enabled])

  useEffect(() => {
    if (!playing || !engineRef.current) return
    const engine = engineRef.current
    if (!enabled.spatial) { engine.panner.pan.setTargetAtTime(0, engine.context.currentTime, 0.05); return }
    const durationMs = 2600 / Math.max(0.12, spatial)
    const from = engine.panner.pan.value
    const target = from > 0.5 ? -1 : 1
    engine.panner.pan.cancelScheduledValues(engine.context.currentTime)
    engine.panner.pan.setValueAtTime(from, engine.context.currentTime)
    engine.panner.pan.linearRampToValueAtTime(target, engine.context.currentTime + durationMs / 1000)
  }, [spatial, playing, enabled.spatial])

  const togglePlayback = () => {
    if (!file) { fileInput.current?.click(); return }
    if (!engineReady) { useNotice('This file is preview-only in this browser. Use a supported audio format to apply effects.'); return }
    if (playing) { stopEngine(); return }
    startPlayback(currentTime >= duration ? 0 : currentTime)
  }

  const exportAudio = async () => {
    const sourceBuffer = decodedRef.current
    if (!sourceBuffer || !file) { useNotice('Add an audio file before exporting.'); return }
    setExporting(true)
    try {
      const rate = (enabled.tempo ? tempo : 1) * (enabled.pitch ? 2 ** (pitch / 12) : 1)
      const length = Math.ceil(sourceBuffer.length / rate)
      const offline = new OfflineAudioContext(sourceBuffer.numberOfChannels, length, sourceBuffer.sampleRate)
      const source = offline.createBufferSource(); const filter = offline.createBiquadFilter(); const panner = offline.createStereoPanner(); const shaper = offline.createWaveShaper()
      source.buffer = sourceBuffer; source.playbackRate.value = rate
      filter.type = 'lowshelf'; filter.frequency.value = 180; filter.gain.value = enabled.bass ? bass : 0
      shaper.curve = makeDistortionCurve(enabled.distortion ? distortion : 0); shaper.oversample = '4x'
      source.connect(filter); filter.connect(shaper); shaper.connect(panner)
      const vocalNodes = connectVocalReducer(offline, panner, offline.destination, enabled.vocal ? vocal : 0, sourceBuffer.numberOfChannels > 1)
      if (enabled.spatial) {
        const durationSeconds = sourceBuffer.duration / rate
        const ramp = Math.max(0.12, spatial) * 2.6
        for (let t = 0, value = 1; t < durationSeconds; t += ramp) { panner.pan.setValueAtTime(value, t); panner.pan.linearRampToValueAtTime(-value, Math.min(t + ramp, durationSeconds)); value *= -1 }
      } else panner.pan.value = 0
      source.start(0)
      let rendered = await offline.startRendering()
      if (enabled.bitDepth && bitDepth < 16) rendered = reduceBitDepth(rendered, bitDepth)
      const wav = encodeWav(rendered)
      const blob = new Blob([wav], { type: 'audio/wav' }); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${file.name.replace(/\.[^.]+$/, '')}-sonora.wav`; a.click(); URL.revokeObjectURL(url)
    } catch (err) {
      useNotice(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed. Try a shorter audio file.')
    } finally { setExporting(false) }
  }

  const encodeWav = (buffer: AudioBuffer) => {
    const channels = buffer.numberOfChannels; const samples = buffer.length; const bytes = new ArrayBuffer(44 + samples * channels * 2); const view = new DataView(bytes)
    const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
    write(0, 'RIFF'); view.setUint32(4, 36 + samples * channels * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * channels * 2, true)
    let offset = 44
    for (let i = 0; i < samples; i++) for (let channel = 0; channel < channels; channel++) { const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i])); view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2 }
    return bytes
  }

  const seek = (value: number) => { setCurrentTime(value); if (playing) startPlayback(value) }
  const applyVibe = (vibe: string) => {
    setSelectedVibe(vibe)
    const defaults: Record<string, { tempo: number; bass: number; spatial: number; pitch: number; bitDepth: number; distortion: number; enabled: Record<Effect, boolean> }> = {
      'Dance floor': { tempo: 1.12, bass: 5, spatial: 0.75, pitch: 0, bitDepth: 16, distortion: 8, enabled: { tempo: true, pitch: false, bass: true, spatial: true, bitDepth: false, vocal: false, distortion: true } },
      'Dreamy': { tempo: 0.92, bass: 1, spatial: 0.3, pitch: -1, bitDepth: 16, distortion: 0, enabled: { tempo: true, pitch: true, bass: true, spatial: true, bitDepth: false, vocal: false, distortion: false } },
      'Bass drop': { tempo: 1, bass: 9, spatial: 0.55, pitch: 0, bitDepth: 16, distortion: 16, enabled: { tempo: true, pitch: false, bass: true, spatial: true, bitDepth: false, vocal: false, distortion: true } },
      'Lo-fi': { tempo: 0.96, bass: 2, spatial: 0.45, pitch: 0, bitDepth: 8, distortion: 12, enabled: { tempo: true, pitch: false, bass: true, spatial: true, bitDepth: true, vocal: false, distortion: true } },
    }
    const settings = defaults[vibe]
    if (!settings) return
    setTempo(settings.tempo); setPitch(settings.pitch); setBass(settings.bass); setSpatial(settings.spatial); setBitDepth(settings.bitDepth); setDistortion(settings.distortion); setVocal(0); setEnabled(settings.enabled)
  }
  const seekFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!file || !duration) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const style = window.getComputedStyle(event.currentTarget)
    const insetLeft = Number.parseFloat(style.paddingLeft) || 0
    const insetRight = Number.parseFloat(style.paddingRight) || 0
    const contentStart = bounds.left + insetLeft
    const contentWidth = bounds.width - insetLeft - insetRight
    const fraction = Math.max(0, Math.min(1, (event.clientX - contentStart) / contentWidth))
    seek(fraction * duration)
  }
  const toggleEffect = (effect: Effect) => setEnabled(current => ({ ...current, [effect]: !current[effect] }))

  return (
    <main className="shell">
      <section className="main-area">
        <header className="topbar"><div className="topbar-left"><Link className="site-wordmark" href="/">sonora</Link><nav className="page-switcher" aria-label="Pages"><Link className="page-switch-link page-switch-active" aria-current="page" href="/">Studio</Link><Link className="page-switch-link" href="/convert">Convert files</Link></nav></div><div className="top-actions"><button className="quiet-button" onClick={() => { setTempo(1); setPitch(0); setBass(0); setSpatial(0.5); setBitDepth(16); setVocal(0); setDistortion(0); setEnabled({ tempo: true, pitch: false, bass: true, spatial: true, bitDepth: false, vocal: false, distortion: false }); setSelectedVibe(''); useNotice('All controls reset.') }}><RotateCcw size={14} /> Reset all</button><button className="export-button" onClick={exportAudio} disabled={exporting || !file}>{exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}{exporting ? 'Rendering…' : 'Export mix'}</button></div></header>

        <div className="content">
          <div className="page-heading"><div><div className="eyebrow"><WandSparkles size={13} /> YOUR PERSONAL AUDIO STUDIO</div><h1>Shape the <span>sound.</span></h1><p>Small adjustments. A whole new feeling.</p></div><div className="headphone-tip"><Headphones size={16} /><span>Best experienced with headphones</span></div></div>

          <section className="player-card">
            <div className="card-topline"><div className="track-label"><span className="playing-bars"><i /><i /><i /><i /></span><span>NOW IN THE STUDIO</span></div><button className="more-button" aria-label="Audio tips" onClick={() => useNotice('Tempo shifts pitch too. Bass uses a low-shelf filter; 8D adds moving stereo panning.')}><CircleHelp size={17} /></button></div>
            <div className="track-row"><div className={`cover-art ${file ? 'has-track' : ''}`}><div className="cover-orbit orbit-one"/><div className="cover-orbit orbit-two"/><AudioWaveform size={28} strokeWidth={1.5} /></div><div className="track-info"><strong>{file ? file.name.replace(/\.[^.]+$/, '') : 'Your next favorite track'}</strong><span>{file ? `${file.type.split('/').pop()?.toUpperCase() || 'AUDIO'} · ${formatTime(duration)}` : 'Bring a song in and make it yours'}</span></div><button className="play-button" onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button></div>
            <div className={`waveform ${file ? 'waveform-ready' : ''}`} onClick={seekFromPointer} role="slider" aria-label="Track position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} tabIndex={0}>
              {waveBars.map((height, i) => <span key={i} className={i / waveBars.length < (duration ? currentTime / duration : 0) ? 'played' : ''} style={{ height: `${height}%` }} />)}
              {file && <div className="playhead" style={{ left: `${duration ? currentTime / duration * 100 : 0}%` }} />}
            </div><div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
            <div className="player-footer"><div className="file-status"><span className={file ? 'status-dot ready' : 'status-dot'} />{file ? (engineReady ? 'Ready to preview' : 'Audio loaded') : 'No track loaded'}</div><button className="add-track" onClick={() => fileInput.current?.click()}>{file ? <><RotateCcw size={14} /> Change track</> : <><Plus size={15} /> Add a track</>}</button></div>
          </section>

          <div className="effects-heading"><div><h2>Pick a vibe</h2><p>One tap sets up a DJ-inspired sound. Fine-tune it if you like.</p></div></div>
          <div className="vibe-grid">{['Dance floor', 'Dreamy', 'Bass drop', 'Lo-fi'].map((vibe, index) => <button key={vibe} className={`vibe-button vibe-${index} ${selectedVibe === vibe ? 'vibe-selected' : ''}`} onClick={() => applyVibe(vibe)}><span className="vibe-emoji">{['✦', '☾', '↗', '〰'][index]}</span><span><strong>{vibe}</strong><small>{['More energy', 'Soft and spacious', 'Big low end', 'Warm and fuzzy'][index]}</small></span>{selectedVibe === vibe && <Check size={15} className="vibe-check" />}</button>)}</div>
          <button className="fine-tune-toggle" aria-expanded={showFineTune} onClick={() => setShowFineTune(value => !value)}><SlidersHorizontal size={15} /> {showFineTune ? 'Hide fine-tune controls' : 'Fine-tune controls'} <span>{Object.values(enabled).filter(Boolean).length} effects on</span><ChevronDown size={15} className={showFineTune ? 'chevron-open' : ''} /></button>

          {showFineTune && <div className="effects-grid">
            <section className={`effect-card ${enabled.tempo ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon tempo-icon"><AudioLines size={19} /></div><button className={`switch ${enabled.tempo ? 'switch-on' : ''}`} aria-label="Toggle tempo" aria-pressed={enabled.tempo} onClick={() => toggleEffect('tempo')}><span /></button></div><div className="effect-title-row"><div><h3>Tempo</h3><p>Find your own pace</p></div><span className="effect-value">{enabled.tempo ? `${tempo.toFixed(2).replace(/0$/, '')}×` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="0.5" max="1.5" step="0.01" value={tempo} onChange={e => setTempo(Number(e.target.value))} style={{ '--range-progress': `${(tempo - 0.5) * 100}%` } as React.CSSProperties} aria-label="Tempo" disabled={!enabled.tempo} /><div className="range-labels"><span>0.5× slower</span><span>1.5× faster</span></div></div><div className="effect-note"><span className="note-indicator" />Changes speed and pitch together</div></section>

            <section className={`effect-card ${enabled.pitch ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon pitch-icon"><SlidersHorizontal size={18} /></div><button className={`switch ${enabled.pitch ? 'switch-on' : ''}`} aria-label="Toggle pitch shift" aria-pressed={enabled.pitch} onClick={() => toggleEffect('pitch')}><span /></button></div><div className="effect-title-row"><div><h3>Change pitch</h3><p>Move the sound up or down</p></div><span className="effect-value">{enabled.pitch ? `${pitch > 0 ? '+' : ''}${pitch} st` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="-12" max="12" step="1" value={pitch} onChange={e => setPitch(Number(e.target.value))} style={{ '--range-progress': `${(pitch + 12) * 100 / 24}%` } as React.CSSProperties} aria-label="Pitch shift" disabled={!enabled.pitch} /><div className="range-labels"><span>−12 semitones</span><span>+12 semitones</span></div></div><div className="effect-note"><span className="note-indicator" />Pitch shifting also changes playback speed</div></section>

            <section className={`effect-card ${enabled.bass ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon bass-icon"><Volume2 size={19} /></div><button className={`switch ${enabled.bass ? 'switch-on' : ''}`} aria-label="Toggle bass" aria-pressed={enabled.bass} onClick={() => toggleEffect('bass')}><span /></button></div><div className="effect-title-row"><div><h3>Bass boost</h3><p>Feel a little more low end</p></div><span className="effect-value">{enabled.bass ? `${bass > 0 ? '+' : ''}${bass} dB` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="-12" max="12" step="1" value={bass} onChange={e => setBass(Number(e.target.value))} style={{ '--range-progress': `${(bass + 12) * 100 / 24}%` } as React.CSSProperties} aria-label="Bass boost" disabled={!enabled.bass} /><div className="range-labels"><span>Less</span><span>More</span></div></div><div className="effect-note"><span className="note-indicator" />Boosts frequencies below 180 Hz</div></section>

            <section className={`effect-card spatial-card ${enabled.spatial ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon spatial-icon"><Headphones size={19} /></div><button className={`switch ${enabled.spatial ? 'switch-on' : ''}`} aria-label="Toggle 8D audio" aria-pressed={enabled.spatial} onClick={() => toggleEffect('spatial')}><span /></button></div><div className="effect-title-row"><div><h3>8D audio</h3><p>Let the sound move around you</p></div><span className="effect-value">{enabled.spatial ? `${spatial.toFixed(1)}×` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="0.2" max="1" step="0.1" value={spatial} onChange={e => setSpatial(Number(e.target.value))} style={{ '--range-progress': `${(spatial - 0.2) / 0.8 * 100}%` } as React.CSSProperties} aria-label="8D movement speed" disabled={!enabled.spatial} /><div className="range-labels"><span>Slow orbit</span><span>Quick orbit</span></div></div><div className="effect-note"><span className="note-indicator" />A stereo effect — headphones recommended</div></section>

            <section className={`effect-card ${enabled.bitDepth ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon bit-icon"><AudioWaveform size={18} /></div><button className={`switch ${enabled.bitDepth ? 'switch-on' : ''}`} aria-label="Toggle bit depth" aria-pressed={enabled.bitDepth} onClick={() => toggleEffect('bitDepth')}><span /></button></div><div className="effect-title-row"><div><h3>Bit depth</h3><p>Add lo-fi digital texture</p></div><span className="effect-value">{enabled.bitDepth ? `${bitDepth}-bit` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="2" max="16" step="1" value={bitDepth} onChange={e => setBitDepth(Number(e.target.value))} style={{ '--range-progress': `${(bitDepth - 2) * 100 / 14}%` } as React.CSSProperties} aria-label="Bit depth" disabled={!enabled.bitDepth} /><div className="range-labels"><span>2-bit crunchy</span><span>16-bit clean</span></div></div><div className="effect-note"><span className="note-indicator" />Lower values create stronger quantization noise</div></section>

            <section className={`effect-card ${enabled.vocal ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon vocal-icon"><Mic2 size={18} /></div><button className={`switch ${enabled.vocal ? 'switch-on' : ''}`} aria-label="Toggle vocal reduction" aria-pressed={enabled.vocal} onClick={() => toggleEffect('vocal')}><span /></button></div><div className="effect-title-row"><div><h3>Vocal remover</h3><p>Reduce centered vocals</p></div><span className="effect-value">{enabled.vocal ? `${Math.round(vocal * 100)}%` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="0" max="1" step="0.05" value={vocal} onChange={e => setVocal(Number(e.target.value))} style={{ '--range-progress': `${vocal * 100}%` } as React.CSSProperties} aria-label="Vocal reduction" disabled={!enabled.vocal} /><div className="range-labels"><span>Subtle</span><span>Strong</span></div></div><div className="effect-note"><span className="note-indicator" />Best on stereo mixes; may reduce centered instruments</div></section>

            <section className={`effect-card ${enabled.distortion ? 'effect-on' : ''}`}><div className="effect-header"><div className="effect-icon distortion-icon"><Zap size={18} /></div><button className={`switch ${enabled.distortion ? 'switch-on' : ''}`} aria-label="Toggle distortion" aria-pressed={enabled.distortion} onClick={() => toggleEffect('distortion')}><span /></button></div><div className="effect-title-row"><div><h3>Distortion</h3><p>Add grit and saturation</p></div><span className="effect-value">{enabled.distortion ? `${distortion}%` : 'Off'}</span></div><div className="range-wrap"><input type="range" min="0" max="100" step="1" value={distortion} onChange={e => setDistortion(Number(e.target.value))} style={{ '--range-progress': `${distortion}%` } as React.CSSProperties} aria-label="Distortion amount" disabled={!enabled.distortion} /><div className="range-labels"><span>Clean</span><span>Rough</span></div></div><div className="effect-note"><span className="note-indicator" />Soft clipping with oversampling</div></section>
          </div>}

          <div className="bottom-note"><div className="note-check"><Check size={14} /></div><span>Effects combine in real time. Your original track is always kept untouched.</span><button onClick={() => useNotice('Tempo changes speed and pitch. Bass shifts the low-frequency balance. 8D moves audio across the left and right channels.')}><CircleHelp size={15} /></button></div>
        </div>
        <footer className="footer"><span>SONORA STUDIO <span className="footer-dot">•</span> A LITTLE MORE YOU IN EVERY TRACK</span><span>MADE FOR THE WAY YOU LISTEN <AudioLines size={13} /></span></footer>
      </section>

      {notice && <div className="toast" role="status">{notice}</div>}
      <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden onChange={e => { const picked = e.target.files?.[0]; if (picked) processFile(picked); e.currentTarget.value = '' }} />
      <div className={`drop-overlay ${dragging ? 'drop-visible' : ''}`} onDragEnter={e => { e.preventDefault(); setDragging(true) }} onDragOver={e => e.preventDefault()} onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }} onDrop={e => { e.preventDefault(); setDragging(false); const dropped = e.dataTransfer.files[0]; if (dropped) processFile(dropped) }}><div className="drop-content"><div className="drop-icon"><Upload size={24} /></div><h2>Drop your track here</h2><p>Your music stays on your device.</p></div></div>
    </main>
  )
}
