'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function PlatformLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const result = await signIn('platform-credentials', {
      email: String(data.get('email') || ''),
      password: String(data.get('password') || ''),
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError('Invalid platform administrator credentials.');
      return;
    }
    router.push('/platform-admin');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-2xl font-bold text-slate-900">Platform Super Admin</h1>
      <p className="mt-1 text-sm text-slate-500">
        This login is separate from organization accounts. Organization admins cannot access platform administration.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="block text-xs font-semibold text-slate-700">Email</label>
          <input name="email" type="email" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700">Password</label>
          <input name="password" type="password" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button disabled={loading} type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {loading ? 'Signing in…' : 'Sign in to Platform Admin'}
        </button>
      </form>
    </div>
  );
}
