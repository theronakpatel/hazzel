import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'sonora — shape the sound',
  description: 'A private, in-browser audio studio for tempo, bass and spatial sound.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
