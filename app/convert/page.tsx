'use client'

import Link from 'next/link'
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, Check, ChevronDown, CircleHelp, Download, FileAudio2, FileVideo2, LoaderCircle, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import type { FFmpeg } from '@ffmpeg/ffmpeg'

type MediaKind = 'audio' | 'video'
type Format = 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac' | 'mp4' | 'webm'

const audioFormats: Format[] = ['mp3', 'wav', 'ogg', 'm4a', 'flac']
const videoFormats: Format[] = ['mp4', 'webm', 'mp3', 'wav']
const mimeTypes: Record<Format, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm' }
const formatNames: Record<Format, string> = { mp3: 'MP3 audio', wav: 'WAV audio', ogg: 'OGG audio', m4a: 'M4A audio', flac: 'FLAC audio', mp4: 'MP4 video', webm: 'WebM video' }
const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`

export default function ConvertPage() {
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<Format>('mp3')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const mediaKind: MediaKind = file?.type.startsWith('video/') ? 'video' : 'audio'
  const formats = useMemo(() => mediaKind === 'video' ? videoFormats : audioFormats, [mediaKind])

  const setSelectedFile = (picked?: File) => {
    if (!picked) return
    if (!picked.type.startsWith('audio/') && !picked.type.startsWith('video/')) { setMessage('Choose an audio or video file.'); return }
    if (picked.size > 500 * 1024 * 1024) { setMessage('This file is over 500 MB. Try a shorter or smaller file.'); return }
    setFile(picked); setMessage(''); setProgress(0)
    setFormat(picked.type.startsWith('video/') ? 'mp4' : 'mp3')
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { setSelectedFile(event.target.files?.[0]); event.currentTarget.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); setSelectedFile(event.dataTransfer.files[0]) }

  const getEngine = async () => {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current
    setMessage('Loading converter engine… (about 31 MB, first use only)')
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')])
    const engine = new FFmpeg()
    engine.on('progress', ({ progress }) => setProgress(Math.max(0, Math.min(99, Math.round(progress * 100)))))
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
    await engine.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegRef.current = engine
    return engine
  }

  const convert = async () => {
    if (!file) return
    setBusy(true); setProgress(0); setMessage('Preparing your file…')
    const inputName = `input-${Date.now()}.${file.name.split('.').pop()?.toLowerCase() || 'bin'}`
    const outputName = `sonora-output.${format}`
    try {
      const ffmpeg = await getEngine()
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))
      const args = ['-i', inputName, '-y']
      if (format === 'mp3') args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2')
      else if (format === 'wav') args.push('-vn', '-c:a', 'pcm_s16le')
      else if (format === 'ogg') args.push('-vn', '-c:a', 'libvorbis', '-q:a', '5')
      else if (format === 'm4a') args.push('-vn', '-c:a', 'aac', '-b:a', '192k')
      else if (format === 'flac') args.push('-vn', '-c:a', 'flac')
      else if (format === 'mp4') args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart')
      else if (format === 'webm') args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '6', '-c:a', 'libvorbis')
      setMessage('Converting in your browser…')
      await ffmpeg.exec([...args, outputName])
      const output = await ffmpeg.readFile(outputName)
      const bytes = output instanceof Uint8Array ? new Uint8Array(output) : new TextEncoder().encode(output)
      const blob = new Blob([bytes.buffer], { type: mimeTypes[format] })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${file.name.replace(/\.[^.]+$/, '')}.${format}`; a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      await ffmpeg.deleteFile(inputName); await ffmpeg.deleteFile(outputName)
      setProgress(100); setMessage('Done — your converted file has been downloaded.')
    } catch (error) {
      setMessage(error instanceof Error ? `Could not convert this file: ${error.message}` : 'Could not convert this file. Try another format or a smaller file.')
    } finally { setBusy(false) }
  }

  return <main className="shell"><section className="main-area">
    <header className="topbar"><div className="topbar-left"><Link className="site-wordmark" href="/">sonora</Link><Link className="nav-tool-link nav-tool-active" href="/convert">Convert files</Link></div><Link className="quiet-button back-link" href="/"><ArrowLeft size={14} /> Back to studio</Link></header>
    <div className="content convert-content">
      <div className="eyebrow"><RefreshCw size={13} /> SIMPLE FILE CONVERTER</div>
      <h1 className="convert-title">One file. <span>Any format.</span></h1>
      <p className="convert-intro">Convert audio and video files right in your browser. Your files stay on your device.</p>
      <section className="convert-card">
        <div className={`upload-zone ${dragging ? 'upload-dragging' : ''} ${file ? 'upload-has-file' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          {file ? <>
            <div className="selected-file-icon">{mediaKind === 'video' ? <FileVideo2 size={23} /> : <FileAudio2 size={23} />}</div>
            <div className="selected-file-info"><strong>{file.name}</strong><span>{mediaKind === 'video' ? 'Video' : 'Audio'} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span></div>
            <button className="change-file" onClick={() => inputRef.current?.click()}>Change file</button>
          </> : <>
            <div className="upload-icon"><Upload size={23} /></div>
            <strong>Drop an audio or video file here</strong>
            <span>or <button className="browse-button" onClick={() => inputRef.current?.click()}>choose a file</button> from your device</span>
            <small>Up to 500 MB · MP3, WAV, M4A, MP4, MOV, WebM and more</small>
          </>}
        </div>
        <input ref={inputRef} type="file" accept="audio/*,video/*" hidden onChange={onFileChange} />
        <div className="convert-options"><div><label htmlFor="format-select">Convert to</label><div className="format-select-wrap"><select id="format-select" value={format} onChange={event => setFormat(event.target.value as Format)} disabled={!file || busy}>{formats.map(item => <option value={item} key={item}>{formatNames[item]}</option>)}</select><ChevronDown size={15} /></div></div><button className="convert-button" onClick={convert} disabled={!file || busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowDown size={16} />}{busy ? 'Converting…' : 'Convert & download'}</button></div>
        {(busy || progress > 0) && <div className="conversion-progress"><div className="conversion-progress-track"><span style={{ width: `${busy ? Math.max(progress, 8) : progress}%` }} /></div><div><span>{message}</span>{busy && progress > 0 && <strong>{progress}%</strong>}</div></div>}
        {!busy && message && <div className={`convert-message ${progress === 100 ? 'convert-success' : 'convert-error'}`}>{progress === 100 ? <Check size={15} /> : <CircleHelp size={15} />}{message}</div>}
      </section>
      <div className="privacy-callout"><ShieldCheck size={17} /><span><strong>Private by design.</strong> Conversion happens on this device. We don’t upload or store your files.</span></div>
      <div className="format-help"><h2>What can I convert?</h2><div className="format-help-grid"><div><strong>Audio files</strong><span>MP3 · WAV · OGG · M4A · FLAC</span></div><div><strong>Video files</strong><span>MP4 · WebM · MOV and common formats</span></div></div><p>Only convert media you own or have permission to use. To convert your own YouTube upload, download it through YouTube Studio first, then add the file here.</p></div>
      <div className="engine-note"><span className="engine-dot" />First conversion loads the browser converter (~31 MB). Large files may take a while depending on your device.</div>
    </div>
    <footer className="footer"><span>SONORA STUDIO <span className="footer-dot">•</span> YOUR FILES STAY YOURS</span><span>MADE FOR THE WAY YOU LISTEN <RefreshCw size={12} /></span></footer>
  </section></main>
}
