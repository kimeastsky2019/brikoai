import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Database,
  ClipboardCheck,
  Search,
  FileCheck2,
  Settings,
  LogOut,
  LogIn,
  Menu,
  X,
  Cpu,
  Brain
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface SidebarLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  statusLine?: React.ReactNode;
  cta?: React.ReactNode;
}

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  children,
  title,
  description,
  statusLine,
  cta,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [engineState, setEngineState] = useState<string>("로딩 중…");
  const [isGpuActive, setIsGpuActive] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setIsLoggedIn(!!token);

    // Fetch active engine for sidebar bottom indicator
    api.getHealth()
      .then((h) => {
        const provider = h?.llm?.active_provider;
        if (provider === "exo") {
          setEngineState("사내 GPU");
          setIsGpuActive(true);
        } else if (provider) {
          setEngineState(provider);
          setIsGpuActive(false);
        } else {
          setEngineState("서버 연결됨");
          setIsGpuActive(true);
        }
      })
      .catch(() => {
        setEngineState("서버 미연결");
        setIsGpuActive(false);
      });
  }, [location.pathname]);

  const handleLogout = () => {
    api.logout();
    setIsLoggedIn(false);
    toast.info("로그아웃되었습니다.");
    navigate("/login");
  };

  const menuItems = [
    {
      name: "자료 준비",
      path: "/source-analysis",
      icon: Upload,
      badge: { text: "완료 · 15건", variant: "success" as const },
    },
    {
      name: "보고서 지식화",
      path: "/knowledge-base",
      icon: Database,
      badge: { text: "주의 · 3건", variant: "warning" as const },
    },
    {
      name: "현장 적용",
      path: "/checklist",
      icon: ClipboardCheck,
      badge: { text: "대기", variant: "waiting" as const },
    },
    {
      name: "진단 탐색",
      path: "/",
      icon: Search,
      badge: { text: "완료", variant: "success" as const },
    },
    {
      name: "검토·승인",
      path: "/dashboard",
      icon: FileCheck2,
      badge: { text: "주의 · 17건", variant: "warning" as const },
    },
  ];

  const getBadgeStyle = (variant: "success" | "warning" | "waiting") => {
    switch (variant) {
      case "success":
        return "bg-[#17B890]/20 text-[#17B890] border-none";
      case "warning":
        return "bg-[#F5B51B]/20 text-[#F5B51B] border-none";
      case "waiting":
        return "bg-slate-500/20 text-slate-400 border-none";
      default:
        return "";
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#101A2D] text-slate-100 p-4 select-none">
      {/* Brand Header */}
      <div className="flex items-center space-x-3 px-2 py-4 mb-6 cursor-pointer" onClick={() => navigate("/")}>
        <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center border border-indigo-500 shadow-[0_0_15px_rgba(81,70,229,0.5)]">
          <Brain className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white leading-none">LMMWiki Console</h2>
          <span className="text-xs text-slate-400">지능형 에너지 진단 위키</span>
        </div>
      </div>

      {/* Navigation Menus */}
      <nav className="flex-1 space-y-1.5">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
          return (
            <button
              key={item.name}
              onClick={() => {
                navigate(item.path);
                setIsMobileOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 outline-none ${
                isActive
                  ? "bg-[#5146E5] text-white shadow-lg shadow-[#5146E5]/20"
                  : "text-slate-300 hover:bg-slate-800/50 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`h-4.5 w-4.5 ${isActive ? "text-white" : "text-slate-400"}`} />
                <span>{item.name}</span>
              </div>
              <Badge className={`text-[10px] px-1.5 py-0.5 rounded ${getBadgeStyle(item.badge.variant)}`}>
                {item.badge.text}
              </Badge>
            </button>
          );
        })}
      </nav>

      {/* Engine Status Summary Widget */}
      <div className="mt-auto border-t border-slate-800 pt-4 pb-2 px-2">
        <div className="flex items-center justify-between rounded-lg bg-slate-900/50 border border-slate-800 p-2.5 text-xs">
          <div className="flex items-center gap-2">
            <Cpu className={`h-4 w-4 ${isGpuActive ? "text-[#17B890]" : "text-amber-500"}`} />
            <div>
              <p className="text-[10px] text-slate-400">활성 엔진</p>
              <p className="font-semibold text-slate-200">{engineState}</p>
            </div>
          </div>
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isGpuActive ? "bg-[#17B890]" : "bg-amber-500"}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isGpuActive ? "bg-[#17B890]" : "bg-amber-500"}`}></span>
          </span>
        </div>
      </div>

      {/* Settings & Auth Footer */}
      <div className="space-y-1 pt-2 border-t border-slate-800 mt-2">
        <button
          onClick={() => {
            navigate("/settings");
            setIsMobileOpen(false);
          }}
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
            location.pathname === "/settings"
              ? "bg-[#5146E5] text-white"
              : "text-slate-300 hover:bg-slate-800/50 hover:text-white"
          }`}
        >
          <Settings className="h-4.5 w-4.5 text-slate-400" />
          <span>환경 설정</span>
        </button>

        {isLoggedIn ? (
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-red-950/30 hover:text-red-400 transition-all"
          >
            <LogOut className="h-4.5 w-4.5 text-slate-400" />
            <span>로그아웃</span>
          </button>
        ) : (
          <button
            onClick={() => {
              navigate("/login");
              setIsMobileOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-indigo-950/30 hover:text-indigo-400 transition-all"
          >
            <LogIn className="h-4.5 w-4.5 text-slate-400" />
            <span>로그인</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#EEF2F7]">
      {/* Sidebar - Desktop */}
      <div className="hidden md:flex md:w-64 md:flex-col md:shrink-0 h-full border-r border-slate-800 shadow-xl">
        {sidebarContent}
      </div>

      {/* Main Panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="flex h-16 items-center justify-between border-b bg-[#101A2D] px-4 md:hidden text-white">
          <div className="flex items-center space-x-3" onClick={() => navigate("/")}>
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-base font-bold text-white">LMMWiki</h1>
          </div>
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="rounded-lg p-1.5 hover:bg-slate-800 text-white"
          >
            {isMobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </header>

        {/* Mobile Sidebar Overlay */}
        {isMobileOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-64 animate-in slide-in-from-left duration-200 h-full shadow-2xl">
              <div className="absolute top-4 right-4 z-50">
                <button
                  onClick={() => setIsMobileOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {sidebarContent}
            </div>
            <div className="flex-1" onClick={() => setIsMobileOpen(false)} />
          </div>
        )}

        {/* Unified Layout Header (only rendered if title is provided) */}
        {title && (
          <header className="bg-white border-b px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shrink-0 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">{title}</h2>
              {description && (
                <p className="text-sm text-slate-500 max-w-2xl leading-snug">{description}</p>
              )}
              {statusLine && (
                <div className="text-xs text-indigo-600 font-semibold mt-1">
                  {statusLine}
                </div>
              )}
            </div>
            {cta && (
              <div className="flex items-center shrink-0">
                {cta}
              </div>
            )}
          </header>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6 focus-visible:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
};

export default SidebarLayout;
