import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Brain, FileText, Zap, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ChatResponse, Collection } from "@/lib/api";
import { toast } from "sonner";
import SidebarLayout from "@/components/SidebarLayout";
import StatDetailDialog, { StatKind } from "@/components/StatDetailDialog";

const ALL = "all";

const Index = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statDetail, setStatDetail] = useState<StatKind | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [collectionSummary, setCollectionSummary] = useState<{ total: number; processed: number; processing: number; failed: number } | null>(null);
  const [summaryPolling, setSummaryPolling] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  // Search Filters
  const [filterCategory, setFilterCategory] = useState("");
  const [filterTags, setFilterTags] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const [dashboardStats, setDashboardStats] = useState<{ documents: number; collections: number; queries: number } | null>(null);
  const [searchCount, setSearchCount] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [statsTick, setStatsTick] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setIsLoggedIn(!!token);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    api.getCollections()
      .then((data) => {
        setCollections(data);
        setLoadFailed(false);
        const stored = localStorage.getItem("rag_collection_id");
        const nextId = stored && (stored === ALL || data.some((c) => String(c.id) === stored))
          ? stored
          : ALL;
        setSelectedCollectionId(nextId);
        localStorage.setItem("rag_collection_id", nextId);
      })
      .catch((e) => {
        console.error(e);
        setLoadFailed(true);
        const expired = String(e?.message || "").includes("401") || !localStorage.getItem("token");
        if (expired) {
          toast.error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
          localStorage.removeItem("token");
          setIsLoggedIn(false);
          navigate("/login");
        } else {
          toast.error("컬렉션 목록을 불러오지 못했습니다. 문서가 지워진 것은 아닙니다.");
        }
      });
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    api.getStats()
      .then((data) => {
        if (!data) return;
        setDashboardStats({
          documents: Number(data.documents || 0),
          collections: Number(data.collections || 0),
          queries: Number(data.queries || 0),
        });
      })
      .catch((e) => console.error(e));
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn || !selectedCollectionId) {
      setCollectionSummary(null);
      setSummaryPolling(false);
      return;
    }

    let intervalId: number | null = null;
    const poll = async () => {
      try {
        const docs = await api.getDocuments(Number(selectedCollectionId), true);
        const total = docs.length;
        const processed = docs.filter((d) => d.status === "processed").length;
        const processing = docs.filter((d) => d.status === "processing").length;
        const failed = docs.filter((d) => d.status === "failed").length;
        setCollectionSummary({ total, processed, processing, failed });
        const hasProcessing = processing > 0;
        setSummaryPolling(hasProcessing);
        if (!hasProcessing && intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      } catch (e) {
        console.error(e);
      }
    };

    poll();
    intervalId = window.setInterval(poll, 5000);
    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [isLoggedIn, selectedCollectionId]);

  const handleSearch = async () => {
    if (!query.trim()) return;

    if (!isLoggedIn) {
      toast.error("검색하려면 로그인이 필요합니다.");
      navigate("/login");
      return;
    }
    if (!selectedCollectionId) {
      toast.error("검색 범위를 선택해 주세요.");
      return;
    }

    setIsSearching(true);
    setResponse(null);

    try {
      const filters: any = {};
      if (filterCategory.trim()) filters.category = filterCategory.trim();
      if (filterTags.trim()) {
        filters.tags = filterTags.split(",").map((t) => t.trim()).filter(Boolean);
      }
      if (filterDateFrom) filters.date_from = filterDateFrom;
      if (filterDateTo) filters.date_to = filterDateTo;

      const res = await api.chat(
        query,
        selectedCollectionId === ALL ? 0 : Number(selectedCollectionId),
        Object.keys(filters).length ? filters : undefined
      );
      setResponse(res);
      setSearchCount((prev) => prev + 1);
      setLastLatencyMs(res.latency_ms);
      setStatsTick((prev) => prev + 1);
    } catch (e: any) {
      if (e?.message?.includes("Failed to fetch")) {
        navigate("/error", {
          state: {
            title: "서버에 연결할 수 없습니다.",
            message: "네트워크 또는 서버 상태를 확인해 주세요. 잠시 후 다시 시도할 수 있습니다.",
          },
        });
        return;
      }
      toast.error("검색 중 오류가 발생했습니다: " + e.message);
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const stats = [
    {
      label: "처리된 문서",
      value: dashboardStats ? dashboardStats.documents.toLocaleString() : "—",
      icon: FileText,
      kind: "documents" as const,
    },
    {
      label: "검색 쿼리",
      value: (dashboardStats ? dashboardStats.queries : 0) + searchCount,
      icon: Search,
      kind: "queries" as const,
    },
    {
      label: "활성 컬렉션",
      value: dashboardStats ? dashboardStats.collections : "—",
      icon: Brain,
      kind: "collections" as const,
    },
    {
      label: "응답 속도",
      value: lastLatencyMs !== null ? `${Math.max(0.1, Math.round(lastLatencyMs / 100) / 10)}초` : "—",
      icon: Zap,
      kind: "latency" as const,
    },
  ];

  // Recommended knowledge cards structured using the required 4-column summary format
  const recommendedKnowledge = [
    {
      title: "보일러 급수 예열 (폐열회수 ECM)",
      current: "210°C (배가스 출구)",
      target: "160°C",
      diff: "+50°C",
      verdict: "보일러 배가스 출구에 급수 예열용 이코노마이저 추가 설치 제안 (예상 투자회수기간: 2.3년)"
    },
    {
      title: "송풍기/펌프 모터 운전 (인버터 제어 ECM)",
      current: "50Hz (밸브 조절 운전)",
      target: "35Hz",
      diff: "+15Hz",
      verdict: "가동율 변동에 맞춰 인버터 VVVF 주파수 제어 도입 추천 (32% 전력량 저감)"
    },
    {
      title: "압축공기 누기 실태 점검 (공정 보전 ECM)",
      current: "22.5% (추정 누기율)",
      target: "10.0%",
      diff: "+12.5%",
      verdict: "현장 누출 부속 실사 후 밸브·커플링 밀봉 작업 추천 (연간 가동 비용 즉각 절감)"
    }
  ];

  const headerCta = (
    <Button
      onClick={handleSearch}
      disabled={!query.trim() || isSearching}
      className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 outline-none"
    >
      {isSearching ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          검색 중...
        </>
      ) : (
        <>
          <Search className="h-4 w-4 mr-2" />
          AI 검색 시작
        </>
      )}
    </Button>
  );

  return (
    <SidebarLayout
      title="진단 탐색"
      description="사내 온프레미스 GPU에 적재된 진단 지식(LLM Wiki)을 대상으로 자연어 질문을 작성하고, 출처가 명시된 근거 답변을 탐색합니다."
      statusLine={
        lastLatencyMs !== null
          ? `최근 RAG 검색 소요 시간: ${lastLatencyMs}ms (캐시: ${response?.cached ? "적용" : "미적용"})`
          : "상태: AI 검색 준비 완료"
      }
      cta={headerCta}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Search & Filter Compact Box */}
        <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
          <CardContent className="p-5 space-y-4">
            
            {/* Horizontal Filter Area (One line layout) */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 bg-slate-50/50 p-3 rounded-lg border border-slate-100">
              
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">검색 범위 (컬렉션)</Label>
                <Select
                  value={selectedCollectionId}
                  onValueChange={(value) => {
                    setSelectedCollectionId(value);
                    localStorage.setItem("rag_collection_id", value);
                  }}
                  disabled={!isLoggedIn}
                >
                  <SelectTrigger className="h-9 bg-white border-slate-200 rounded-lg text-xs">
                    <SelectValue placeholder="검색 범위 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      전체 보고서 {collections.length > 0 && ` (${collections.length}건)`}
                    </SelectItem>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} {typeof c.documents_count === "number" && ` (${c.documents_count}개)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:w-36 space-y-1">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">카테고리</Label>
                <Input
                  placeholder="예: 정책, 보고서"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  disabled={!isLoggedIn}
                  className="h-9 bg-white border-slate-200 rounded-lg text-xs"
                />
              </div>

              <div className="md:w-44 space-y-1">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">태그 필터</Label>
                <Input
                  placeholder="쉼표로 태그 구분"
                  value={filterTags}
                  onChange={(e) => setFilterTags(e.target.value)}
                  disabled={!isLoggedIn}
                  className="h-9 bg-white border-slate-200 rounded-lg text-xs"
                />
              </div>

              <div className="md:w-28 space-y-1">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">시작일</Label>
                <Input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  disabled={!isLoggedIn}
                  className="h-9 bg-white border-slate-200 rounded-lg text-xs"
                />
              </div>

              <div className="md:w-28 space-y-1">
                <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">종료일</Label>
                <Input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  disabled={!isLoggedIn}
                  className="h-9 bg-white border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>

            {/* Collection Processing Stats Block */}
            {collectionSummary && (
              <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-2.5 text-xs text-slate-500 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span>수집 문서: <strong>{collectionSummary.total}개</strong></span>
                  <span>•</span>
                  <span className="text-[#17B890]">처리 완료: <strong>{collectionSummary.processed}</strong></span>
                  <span>•</span>
                  <span className="text-indigo-600">인덱싱 중: <strong>{collectionSummary.processing}</strong></span>
                  <span>•</span>
                  <span className="text-red-500">실패: <strong>{collectionSummary.failed}</strong></span>
                </div>
                {summaryPolling && (
                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium animate-pulse">
                    인덱싱 자동 동기화 중 (5초 간격)
                  </span>
                )}
              </div>
            )}

            {/* Prompt input field */}
            <div className="space-y-3">
              <Textarea
                placeholder={
                  isLoggedIn
                    ? "에너지 진단 관련 질문을 입력하세요.\n예: '보일러 배가스 폐열회수 이코노마이저 설치 시 평균 회수기간은?' 또는 '압축공기 누기율 기준을 위반한 사업장은?'"
                    : "로그인 세션이 유효하지 않습니다. 좌측 메뉴 하단의 로그인 버튼을 이용해주세요."
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-[110px] resize-none rounded-lg border-slate-200 focus:border-[#5146E5] focus:ring-1 focus:ring-[#5146E5] text-sm leading-relaxed p-3.5 outline-none"
                onClick={() => !isLoggedIn && navigate("/login")}
              />
              
              {isLoggedIn && !query && collections.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs font-bold text-slate-400 mr-1">추천 질의:</span>
                  {[
                    "개선 권고사항과 예상 절감액을 정리해줘",
                    "회수기간이 가장 짧은 개선안은?",
                    "공기압축기 관련 지적사항을 모아줘",
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuery(q)}
                      className="text-xs rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600 hover:border-[#5146E5] hover:text-[#5146E5] transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

          </CardContent>
        </Card>

        {/* Answer Output Grid */}
        {response ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
            <Card className="rounded-xl border border-indigo-100 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-indigo-50/50 bg-indigo-50/10 flex flex-row items-center justify-between py-3.5 px-5">
                <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Brain className="w-5 h-5 text-[#5146E5]" />
                  AI 추론 답변 (근거 매핑)
                </CardTitle>
                {response.cached && (
                  <Badge className="bg-[#17B890]/25 text-[#17B890] border-none font-semibold text-[10px]">
                    결과 캐싱됨
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                
                {response.answer.startsWith("문서가 아직 인덱싱") && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-4 space-y-2.5">
                    <div className="flex items-center space-x-3">
                      <Loader2 className="h-5 w-5 text-[#5146E5] animate-spin" />
                      <div>
                        <p className="text-xs font-bold text-slate-800">문서 청크 분해 중</p>
                        <p className="text-[10px] text-slate-400">RAG 지식 인덱스가 완전히 구축되면 지식 응답 품질이 더욱 정밀해집니다.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="prose prose-sm max-w-none text-slate-800 whitespace-pre-wrap text-sm leading-relaxed">
                  {response.answer}
                </div>
                <p className="text-[10px] text-slate-400 border-t pt-3">
                  ※ 본 답변은 적재된 원천 문서(PDF) 채널에서 파싱된 온톨로지 지식에 의거하여 생성되었습니다.
                </p>

                {/* Citations Box */}
                {response.citations && response.citations.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <h4 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-slate-400" />
                      참고 인용 문헌 및 스팬 (Citations)
                    </h4>
                    <div className="grid gap-2">
                      {response.citations.map((cite, idx) => (
                        <div key={idx} className="text-xs bg-slate-50 rounded-lg p-3 border border-slate-100/60 flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded bg-slate-200/60 flex items-center justify-center font-bold text-slate-600 shrink-0">
                            {idx + 1}
                          </span>
                          <div className="space-y-1">
                            <span className="font-bold text-[#5146E5] block">
                              {cite.title || "지정되지 않은 문헌"}
                            </span>
                            <p className="text-slate-600 leading-normal text-[11px] font-medium bg-white p-2 rounded border border-slate-100">
                              {cite.content || cite.snippet}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Recommended Knowledge list (Pre-search state) */
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">주요 실사 추천 지식 (4칸 요약 기준)</h3>
            <div className="grid grid-cols-1 gap-4">
              {recommendedKnowledge.map((card, idx) => (
                <Card key={idx} className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
                  <CardHeader className="bg-slate-50/50 py-3 px-4 border-b border-slate-100">
                    <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <span className="w-1.5 h-3.5 bg-[#5146E5] rounded-full inline-block"></span>
                      {card.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {/* 4-column summary format instead of generic charts */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs border border-slate-100 rounded-lg bg-slate-50/30 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      <div className="p-3">
                        <span className="text-[10px] text-slate-400 font-bold block mb-0.5">현재 값 (Current)</span>
                        <span className="font-bold text-slate-700">{card.current}</span>
                      </div>
                      <div className="p-3">
                        <span className="text-[10px] text-slate-400 font-bold block mb-0.5">기준 값 (Reference)</span>
                        <span className="font-bold text-slate-700">{card.target}</span>
                      </div>
                      <div className="p-3">
                        <span className="text-[10px] text-slate-400 font-bold block mb-0.5">수치 차이 (Diff)</span>
                        <span className="font-bold text-red-600">{card.diff}</span>
                      </div>
                      <div className="p-3">
                        <span className="text-[10px] text-slate-400 font-bold block mb-0.5">진단 판단 (Verdict)</span>
                        <span className="font-semibold text-slate-700 leading-normal block">{card.verdict}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Quick Stats overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card
                key={index}
                role="button"
                tabIndex={0}
                onClick={() => setStatDetail(stat.kind)}
                className="text-center rounded-xl border border-slate-200/80 cursor-pointer bg-white hover:shadow-md hover:border-[#5146E5]/40 transition-all p-4 outline-none"
              >
                <CardContent className="p-0 flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center mb-2.5 border border-slate-100">
                    <Icon className="w-5 h-5 text-[#5146E5]" />
                  </div>
                  <div className="text-xl font-bold text-slate-800">{stat.value}</div>
                  <div className="text-[11px] text-slate-400 font-bold mt-0.5">{stat.label}</div>
                  <span className="text-[9px] text-[#5146E5] font-bold mt-2">상세 정보 →</span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <StatDetailDialog kind={statDetail} onClose={() => setStatDetail(null)} />
      </div>
    </SidebarLayout>
  );
};

export default Index;
