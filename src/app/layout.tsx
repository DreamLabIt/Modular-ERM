import type { Metadata } from 'next';
import type { LayoutProps } from '@/core/types';
import './globals.css';

export const metadata: Metadata = {
  title: 'Modular ERM Platform',
  description: 'Commercial Multi-Tenant Enterprise Resource Management System',
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
