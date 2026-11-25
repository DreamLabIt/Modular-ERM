"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  Mail,
  LockKeyhole,
  ArrowRight,
  ShieldCheck,
  Building2,
} from "lucide-react";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError("Invalid email or password. Please try again.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-3 sm:p-6 lg:p-10">
      <div className="w-full max-w-[1200px] min-h-[720px] overflow-hidden rounded-2xl bg-[#ffffff] shadow-2xl shadow-slate-100/10 grid grid-cols-1 lg:grid-cols-2">
        <section className="relative flex flex-col px-6 py-8 sm:px-12 lg:px-16 xl:px-20">
          <Link href="/login" className="inline-flex w-fit items-center">
            <Image
              src="https://dreamlabit.com/wp-content/uploads/2025/11/Logo-Dreamlab-IT.svg"
              alt="DreamLab IT"
              width={100}
              height={50}
              className="h-11 w-auto max-w-[190px] object-contain"
            />
          </Link>

          <div className="my-auto w-full max-w-[420px] mx-auto py-12 lg:py-16">
            <div className="mb-9">
              <h1 className="text-3xl sm:text-[36px] font-bold tracking-tight text-[#172554]">
                Welcome back!
              </h1>

              <p className="mt-3 text-sm leading-6 text-[#475569]">
                Sign in to your DreamLab IT workspace and manage your business
                from one place.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-[#172554]"
                >
                  Email Address
                </label>

                <div className="relative">
                  <Mail
                    size={18}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#959192]"
                  />

                  <input
                    id="email"
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    className="h-[52px] w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] pl-12 pr-4 text-sm text-[#172554] outline-none transition-all placeholder:text-[#959192] hover:border-[#e2e8f0] focus:border-[#4a92cf] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#4a92cf]/10"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-sm font-semibold text-[#172554]"
                  >
                    Password
                  </label>
                </div>

                <div className="relative">
                  <LockKeyhole
                    size={18}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#959192]"
                  />

                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="h-[52px] w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] pl-12 pr-12 text-sm text-[#172554] outline-none transition-all placeholder:text-[#959192] hover:border-[#e2e8f0] focus:border-[#4a92cf] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#4a92cf]/10"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#959192] transition-colors hover:text-[#4678bc]"
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-[#4678bc] px-5 text-sm font-semibold text-[#ffffff] shadow-lg shadow-[#4678bc]/20 transition-all hover:bg-[#3b5aa9] hover:shadow-xl hover:shadow-[#4678bc]/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#ffffff]/30 border-t-[#ffffff]" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In to Workspace
                    <ArrowRight
                      size={18}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-[#475569]">
              New organization?{" "}
              <Link
                href="/register"
                className="font-semibold text-[#4678bc] transition-colors hover:text-[#3b5aa9] hover:underline"
              >
                Create Workspace
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] pt-5 text-xs text-[#959192]">
            <span>© {new Date().getFullYear()} DreamLab IT</span>
            <span>Enterprise Resource Planning</span>
          </div>
        </section>

        <section className="relative hidden overflow-hidden bg-[#2f419a] px-10 py-12 text-[#ffffff] lg:flex lg:flex-col lg:items-center lg:justify-center">
          <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full border border-[#ffffff]/10" />
          <div className="pointer-events-none absolute -right-8 -top-8 h-52 w-52 rounded-full border border-[#ffffff]/10" />
          <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full border border-[#ffffff]/10" />

          <div className="pointer-events-none absolute right-12 top-20 grid grid-cols-4 gap-3 opacity-20">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className={`h-9 w-9 rounded-lg bg-[#4a92cf] ${
                  i % 3 === 0 ? "opacity-40" : ""
                }`}
              />
            ))}
          </div>

          <div className="relative z-10 w-full max-w-[460px]">
            <div className="relative mx-auto mb-14 max-w-[420px]">
              <div className="rounded-2xl bg-[#ffffff] p-6 shadow-2xl shadow-black/20">
                <div className="mb-7 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[#959192]">BUSINESS OVERVIEW</p>
                    <h3 className="mt-1 text-lg font-bold text-[#172554]">
                      Business Analytics
                    </h3>
                  </div>

                  <div className="rounded-lg bg-[#f8fafc] p-2 text-[#4678bc]">
                    <Building2 size={20} />
                  </div>
                </div>

                <div className="mb-5 flex items-center gap-5">
                  <div>
                    <p className="text-xs text-[#959192]">Performance</p>
                    <p className="mt-1 text-2xl font-bold text-[#172554]">
                      94.8%
                    </p>
                  </div>
                  <div className="rounded-full bg-[#f8fafc] px-2.5 py-1 text-xs font-semibold text-[#2d72ba]">
                    +12.5%
                  </div>
                </div>

                <div className="relative h-[150px] w-full">
                  <div className="absolute inset-0 flex flex-col justify-between">
                    {[1, 2, 3, 4].map((item) => (
                      <div
                        key={item}
                        className="border-t border-dashed border-[#e2e8f0]"
                      />
                    ))}
                  </div>

                  <svg
                    viewBox="0 0 380 150"
                    className="absolute inset-0 h-full w-full"
                    fill="none"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient
                        id="chartFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#4678bc"
                          stopOpacity=".25"
                        />
                        <stop
                          offset="100%"
                          stopColor="#4a92cf"
                          stopOpacity="0"
                        />
                      </linearGradient>
                    </defs>

                    <path
                      d="M0 118 L60 90 L120 101 L180 48 L240 69 L300 32 L380 12 L380 150 L0 150 Z"
                      fill="url(#chartFill)"
                    />

                    <path
                      d="M0 118 L60 90 L120 101 L180 48 L240 69 L300 32 L380 12"
                      stroke="#4678bc"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {[0, 60, 120, 180, 240, 300, 380].map((x, i) => {
                      const y = [118, 90, 101, 48, 69, 32, 12][i];
                      return (
                        <circle
                          key={x}
                          cx={x}
                          cy={y}
                          r="4"
                          fill="#4678bc"
                          stroke="#ffffff"
                          strokeWidth="2"
                        />
                      );
                    })}
                  </svg>
                </div>

                <div className="mt-3 flex justify-between text-[10px] font-medium text-[#959192]">
                  <span>JAN</span>
                  <span>FEB</span>
                  <span>MAR</span>
                  <span>APR</span>
                  <span>MAY</span>
                  <span>JUN</span>
                </div>
              </div>

              <div className="absolute -bottom-10 -right-4 w-[190px] rounded-2xl bg-[#ffffff] p-4 shadow-2xl shadow-black/20 sm:-right-8">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-[7px] border-[#4678bc] border-r-[#e2e8f0]">
                    <span className="text-[11px] font-bold text-[#172554]">
                      85%
                    </span>
                  </div>

                  <div>
                    <p className="text-[11px] text-[#959192]">Efficiency</p>
                    <p className="text-sm font-bold text-[#172554]">
                      Excellent
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-20 text-center">
              <div className="mb-4 inline-flex px-4 py-2 text-xs font-medium tracking-wider text-[#79b9f1]">
                DREAMLAB IT · ENTERPRISE
              </div>

              <h2 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
                Manage Your Business
                <span className="mt-2 block text-[#79b9f1]">
                  Smarter & Better.
                </span>
              </h2>

              <p className="mx-auto mt-5 max-w-[380px] text-sm leading-7 text-[#ffffff]/65">
                One powerful platform to manage your people, projects, finances,
                inventory and business operations.
              </p>
            </div>

            <div className="mt-10 flex items-center justify-center gap-2 text-xs text-[#ffffff]/50">
              <ShieldCheck size={15} />
              Secure Enterprise Workspace
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
