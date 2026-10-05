import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'hezzal — audio studio & format converter',
  description: 'A private, in-browser audio studio and media format converter.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
