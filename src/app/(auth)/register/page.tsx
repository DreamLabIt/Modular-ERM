"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  UserRound,
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Layers3,
} from "lucide-react";

import { registerOrganizationAction } from "./actions";
import { MODULE_REGISTRY } from "@/core/modules/registry";
import Image from "next/image";

export default function RegisterClientPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const formData = new FormData(e.currentTarget);

      const result = await registerOrganizationAction(formData);

      if (result?.error) {
        setError(result.error);
        return;
      }

      router.push("/login");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-3 sm:p-6 lg:p-10">
      <div className="w-full max-w-[1250px] min-h-[760px] overflow-hidden rounded-2xl bg-[#ffffff] shadow-2xl shadow-slate-100/10 grid grid-cols-1 lg:grid-cols-2">
        <section className="relative hidden overflow-hidden bg-[#2f419a] px-10 py-12 text-[#ffffff] lg:flex lg:flex-col lg:items-center lg:justify-center">
          <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full border border-[#ffffff]/10" />

          <div className="pointer-events-none absolute -right-8 -top-8 h-52 w-52 rounded-full border border-[#ffffff]/10" />

          <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full border border-[#ffffff]/10" />

          <div className="pointer-events-none absolute left-12 top-16 grid grid-cols-4 gap-3 opacity-20">
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
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium tracking-wide text-[#959192]">
                      DREAMLAB IT
                    </p>

                    <h3 className="mt-1 text-lg font-bold text-[#172554]">
                      Business Workspace
                    </h3>
                  </div>

                  <div className="rounded-xl bg-[#f8fafc] p-3 text-[#4678bc]">
                    <Building2 size={23} />
                  </div>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      icon: "01",
                      title: "Financial Management",
                      description: "Manage business finances",
                    },
                    {
                      icon: "02",
                      title: "Human Resources",
                      description: "Organize your workforce",
                    },
                    {
                      icon: "03",
                      title: "Inventory Management",
                      description: "Track products and stock",
                    },
                    {
                      icon: "04",
                      title: "Business Analytics",
                      description: "Understand your performance",
                    },
                  ].map((item) => (
                    <div
                      key={item.icon}
                      className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ffffff] text-xs font-bold text-[#4678bc]">
                        {item.icon}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-[#172554]">
                          {item.title}
                        </p>
                        <p className="mt-1 text-[10px] text-[#959192]">
                          {item.description}
                        </p>
                      </div>

                      <CheckCircle2 size={17} className="text-[#4678bc]" />
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex items-center gap-3 rounded-xl bg-[#f8fafc] p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4678bc] text-[#ffffff]">
                    <ShieldCheck size={20} />
                  </div>

                  <div>
                    <p className="text-xs font-bold text-[#172554]">
                      Your Business, One Platform
                    </p>
                    <p className="mt-1 text-[10px] text-[#475569]">
                      Everything organized in one workspace.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-16 text-center">
              <div className="mb-4 inline-flex px-4 py-2 text-xs font-medium tracking-wider text-[#79b9f1]">
                DREAMLAB IT · ENTERPRISE
              </div>

              <h2 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
                Build Your Business
                <span className="mt-2 block text-[#79b9f1]">
                  Without Limits.
                </span>
              </h2>

              <p className="mx-auto mt-5 max-w-[380px] text-sm leading-7 text-[#ffffff]/65">
                Bring your people, projects, inventory and business operations
                together with one powerful ERP platform.
              </p>
            </div>

            <div className="mt-9 flex items-center justify-center gap-2 text-xs text-[#ffffff]/50">
              <ShieldCheck size={15} />
              Secure Enterprise Workspace
            </div>
          </div>
        </section>

        <section className="relative flex flex-col px-6 py-8 sm:px-10 lg:px-14 xl:px-16">
          <Link href="/register" className="inline-flex w-fit items-center">
            <Image
              src="https://dreamlabit.com/wp-content/uploads/2025/11/Logo-Dreamlab-IT.svg"
              alt="DreamLab IT"
              width={100}
              height={50}
              className="h-11 w-auto max-w-[190px] object-contain"
            />
          </Link>

          <div className="my-auto w-full max-w-[480px] mx-auto py-10">
            <div className="mb-7">
              <h1 className="text-3xl sm:text-[34px] font-bold tracking-tight text-[#172554]">
                Create your workspace
              </h1>

              <p className="mt-2 text-sm leading-6 text-[#475569]">
                Set up your organization and choose the ERP modules that fit
                your business needs.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                <span className="mt-0.5">!</span>
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f8fafc] text-[#4678bc]">
                    <Building2 size={17} />
                  </div>

                  <div>
                    <h2 className="text-sm font-bold text-[#172554]">
                      Organization Information
                    </h2>
                    <p className="text-[11px] text-[#959192]">
                      Tell us about your company
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="companyName"
                    className="mb-2 block text-sm font-semibold text-[#172554]"
                  >
                    Company Name
                  </label>

                  <div className="relative">
                    <Building2
                      size={17}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-[#959192]"
                    />

                    <input
                      id="companyName"
                      name="companyName"
                      type="text"
                      required
                      autoComplete="organization"
                      placeholder="Enter your company name"
                      className="h-[49px] w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] pl-11 pr-4 text-sm text-[#172554] outline-none transition-all placeholder:text-[#959192] hover:border-[#e2e8f0] focus:border-[#4a92cf] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#4a92cf]/10"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f8fafc] text-[#4678bc]">
                    <UserRound size={17} />
                  </div>

                  <div>
                    <h2 className="text-sm font-bold text-[#172554]">
                      Administrator Account
                    </h2>
                    <p className="text-[11px] text-[#959192]">
                      Create your admin credentials
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="ownerName"
                      className="mb-2 block text-sm font-semibold text-[#172554]"
                    >
                      Admin Full Name
                    </label>

                    <div className="relative">
                      <UserRound
                        size={17}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-[#959192]"
                      />

                      <input
                        id="ownerName"
                        name="ownerName"
                        type="text"
                        required
                        autoComplete="name"
                        placeholder="Enter administrator name"
                        className="h-[49px] w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] pl-11 pr-4 text-sm text-[#172554] outline-none transition-all placeholder:text-[#959192] hover:border-[#e2e8f0] focus:border-[#4a92cf] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#4a92cf]/10"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="email"
                      className="mb-2 block text-sm font-semibold text-[#172554]"
                    >
                      Admin Email Address
                    </label>

                    <div className="relative">
                      <Mail
                        size={17}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-[#959192]"
                      />

                      <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="admin@company.com"
                        className="h-[49px] w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] pl-11 pr-4 text-sm text-[#172554] outline-none transition-all placeholder:text-[#959192] hover:border-[#e2e8f0] focus:border-[#4a92cf] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#4a92cf]/10"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="password"
                      className="mb-2 block text-sm font-semibold text-[#172554]"
                    >
                      Password
                    </label>

                    <div className="relative">
                      <LockKeyhole
                        size={17}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-[#959192]"
                      />

                      <input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        placeholder="Create a secure password"
                        className="h-[49px] w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] pl-11 pr-12 text-sm text-[#172554] outline-none transition-all placeholder:text-[#959192] hover:border-[#e2e8f0] focus:border-[#4a92cf] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#4a92cf]/10"
                      />

                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#959192] transition-colors hover:text-[#4678bc]"
                      >
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-[#959192]">
                      Password must contain at least 6 characters.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f8fafc] text-[#4678bc]">
                      <Layers3 size={17} />
                    </div>

                    <div>
                      <h2 className="text-sm font-bold text-[#172554]">
                        Licensed ERP Modules
                      </h2>
                      <p className="text-[11px] text-[#959192]">
                        Select the modules for your workspace
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 rounded-full bg-[#f8fafc] px-2.5 py-1 text-[10px] font-semibold text-[#4678bc]">
                    Available Modules
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {Object.values(MODULE_REGISTRY).map((mod) => (
                    <label
                      key={mod.key}
                      className="group flex cursor-pointer items-start gap-3 rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-3 transition-all hover:border-[#4a92cf]/50 hover:bg-[#f8fafc] has-[:checked]:border-[#4678bc] has-[:checked]:bg-[#f8fafc]"
                    >
                      <input
                        type="checkbox"
                        name="modules"
                        value={mod.key}
                        defaultChecked
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#4678bc]"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-[#172554]">
                            {mod.name}
                          </span>

                          <CheckCircle2
                            size={14}
                            className="shrink-0 text-[#4678bc] opacity-0 transition-opacity group-has-[:checked]:opacity-100"
                          />
                        </div>
                      </div>
                    </label>
                  ))}
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
                    Creating Workspace...
                  </>
                ) : (
                  <>
                    Create Workspace
                    <ArrowRight
                      size={18}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-[#475569]">
              Already have a workspace?{" "}
              <Link
                href="/login"
                className="font-semibold text-[#4678bc] transition-colors hover:text-[#3b5aa9] hover:underline"
              >
                Sign In
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] pt-5 text-xs text-[#959192]">
            <span>© {new Date().getFullYear()} DreamLab IT</span>
            <span>Enterprise Resource Planning</span>
          </div>
        </section>
      </div>
    </main>
  );
}
