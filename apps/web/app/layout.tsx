import type { Metadata } from 'next';
import './globals.css';
import './auth.css';
import './workspace.css';
import './messaging.css';
import { AuthGate } from './auth-gate';
export const metadata: Metadata = { title: 'OkayChat — Business conversations, made simple', description: 'Your WhatsApp business workspace.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AuthGate>{children}</AuthGate></body></html>; }
