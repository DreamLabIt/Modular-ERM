"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Banknote,
  Handshake,
  FolderKanban,
  Calculator,
  Package,
  ShoppingCart,
  BarChart3,
  ShieldCheck,
  Settings,
  LogOut,
  Layers,
  Menu,
  X,
  Bell,
  Workflow,
  ClipboardCheck,
  Database,
  ScrollText,
  History,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import type { SidebarProps } from "@/core/types";
import { hasPermission } from "@/lib/permissions";

const iconMap: Record<string, LucideIcon> = {
  Users,
  Banknote,
  Handshake,
  FolderKanban,
  Calculator,
  Package,
  ShoppingCart,
  BarChart3,
  ShieldCheck,
  Bell,
  Workflow,
  ClipboardCheck,
  Database,
  ScrollText,
  History,
};

export function Sidebar({
  organizationName,
  organizationLogoUrl,
  plan,
  userName,
  roleName,
  authorization,
  activeModules,
}: SidebarProps) {
  const pathname = usePathname();
  const [logoError, setLogoError] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const shouldShowLogo = Boolean(organizationLogoUrl?.trim()) && !logoError;
  const visibleModules = activeModules
    .map((module) => ({
      ...module,
      navItems: module.navItems.filter(
        (item) =>
          !item.permission ||
        hasPermission(authorization, item.permission),
      ),
    }))
    .filter((module) => module.navItems.length > 0);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      <div className="lg:hidden w-full h-14 px-3 bg-slate-950 text-slate-200 border-b border-slate-800 flex items-center gap-3 shrink-0 sticky top-0 z-30">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="inline-flex items-center justify-center p-2 rounded-lg text-slate-200 hover:bg-slate-900 border border-slate-800 transition shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link
          href="/dashboard"
          aria-label={organizationName}
          className="flex items-center gap-2 min-w-0 flex-1"
        >
          {shouldShowLogo && organizationLogoUrl ? (
            <div className="relative h-9 w-36 max-w-full">
              <Image
                key={organizationLogoUrl}
                src={organizationLogoUrl}
                alt={organizationName || "Organization Logo"}
                fill
                sizes="144px"
                className="bg-slate-800 object-contain rounded-lg"
                onError={() => setLogoError(true)}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0 bg-primary">
                {organizationName.charAt(0).toUpperCase()}
              </div>
              <span className="font-bold text-white truncate text-sm">
                {organizationName}
              </span>
            </div>
          )}
        </Link>
      </div>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px] transition-opacity"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-64 max-w-[85vw] shrink-0 flex-col overflow-hidden border-r border-slate-800/80 bg-slate-950 text-slate-200 transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center justify-center gap-2.5 flex-1 min-w-0">
              {shouldShowLogo && organizationLogoUrl ? (
                <div className="relative w-full h-10">
                  <Image
                    key={organizationLogoUrl}
                    src={organizationLogoUrl}
                    alt={organizationName || "Organization Logo"}
                    fill
                    sizes="200px"
                    className="bg-slate-800 object-contain rounded-lg"
                    onError={() => setLogoError(true)}
                  />
                </div>
              ) : (
                <>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-base shrink-0 bg-primary">
                    {organizationName.charAt(0).toUpperCase()}
                  </div>
                  <div className="overflow-hidden min-w-0">
                    <div className="font-bold text-white truncate text-sm">
                      {organizationName}
                    </div>
                    <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                      {plan}
                    </span>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="sidebar-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain p-3">
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                pathname === "/dashboard"
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-slate-900"
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span className="truncate">Dashboard</span>
            </Link>

            {visibleModules.map((mod) => {
              const Icon = iconMap[mod.icon] || Layers;
              return (
                <div key={mod.key}>
                  <div className="px-3 mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="truncate">{mod.name}</span>
                  </div>
                  <div className="space-y-0.5">
                    {mod.navItems.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        pathname.startsWith(item.href + "/");
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className={`block pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium transition truncate ${
                            isActive
                              ? "bg-slate-800 text-blue-300 font-semibold"
                              : "text-slate-400 hover:text-white hover:bg-slate-900"
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="pt-2 border-t border-slate-800">
              <div className="px-3 mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Settings className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>System</span>
              </div>
              <div className="space-y-0.5">
                {[
                  { label: "Approvals", href: "/approvals", permissions: ["workflow.view"], icon: ClipboardCheck },
                  { label: "Workflows", href: "/workflows", permissions: ["workflow.view", "workflow.manage"], icon: Workflow },
                  { label: "Notifications", href: "/notifications", permissions: ["notifications.view"], icon: Bell },
                  { label: "Settings", href: "/settings", permissions: ["settings.manage"], icon: Settings },
                  { label: "Security & Audit", href: "/settings/security", permissions: ["audit.view", "login_history.view", "sessions.manage"], icon: ScrollText },
                  { label: "Data Management", href: "/settings/data-management", permissions: ["data.export", "data.import"], icon: Database },
                ]
                  .filter((item) => item.permissions.some((permission) => hasPermission(authorization, permission as never)))
                  .map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition truncate ${
                          isActive ? "bg-slate-800 text-blue-300 font-semibold" : "text-slate-400 hover:text-white hover:bg-slate-900"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          </nav>
        </div>

        <div className="p-2 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0 bg-slate-950">
          <div className="px-2 text-xs min-w-0 flex-1">
            <div className="font-semibold text-white truncate">{userName}</div>
            <div className="text-slate-400 text-[11px] truncate">
              Role: {roleName}
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-red-950/50 transition shrink-0"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
