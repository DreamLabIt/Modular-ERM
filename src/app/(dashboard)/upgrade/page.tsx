import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { UpgradeModulePageProps } from '@/core/types';
import { MODULE_REGISTRY } from '@/core/modules/registry';

export default function UpgradeModulePage({ searchParams }: UpgradeModulePageProps) {
  const mod = MODULE_REGISTRY[searchParams.module || ''];
  return (
    <div className="max-w-lg mx-auto mt-16 bg-white rounded-xl border border-slate-200 p-8 text-center shadow-sm">
      <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
        <Lock className="w-6 h-6" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">
        {mod ? `${mod.name} Module is Locked` : 'Module Not Enabled'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {mod ? mod.description : 'Enable this module in White-Label & Licensing settings.'}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/settings" className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          Manage Modules
        </Link>
        <Link href="/dashboard" className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
