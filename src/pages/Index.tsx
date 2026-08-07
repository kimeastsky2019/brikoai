import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Upload, Brain, Zap, FileText, MessageSquare, Settings, BarChart3, LogIn, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ChatResponse, Collection } from "@/lib/api";
import { toast } from "sonner";
import Header from "@/components/Header"; // Import Header

const Index = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [collectionSummary, setCollectionSummary] = useState<{ total: number; processed: number; processing: number; failed: number } | null>(null);
  const [summaryPolling, setSummaryPolling] = useState(false);
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
        const stored = localStorage.getItem("rag_collection_id");
        const nextId = stored && data.some((c) => String(c.id) === stored) ? stored : (data[0] ? String(data[0].id) : "");
        setSelectedCollectionId(nextId);
        if (nextId) localStorage.setItem("rag_collection_id", nextId);
      })
      .catch((e) => {
        console.error(e);
        toast.error("컬렉션 목록을 불러오지 못했습니다.");
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

  const handleAuthAction = (action: () => void) => {
    if (isLoggedIn) {
      action();
    } else {
      navigate("/login");
    }
  };

  const handleLogout = () => {
    api.logout();
    setIsLoggedIn(false);
    toast.info("로그아웃되었습니다.");
  };

  const handleSearch = async () => {
    if (!query.trim()) return;

    if (!isLoggedIn) {
      toast.error("검색하려면 로그인이 필요합니다.");
      navigate("/login");
      return;
    }
    if (!selectedCollectionId) {
      toast.error("검색할 컬렉션을 선택해 주세요.");
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
        Number(selectedCollectionId),
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

  const features = [
    {
      icon: Brain,
      title: "AI 기반 검색",
      description: "Grok API를 활용한 지능형 문서 검색 및 질의응답"
    },
    {
      icon: Upload,
      title: "문서 업로드",
      description: "PDF, TXT 등 다양한 형식의 문서를 컬렉션에 업로드"
    },
    {
      icon: Zap,
      title: "실시간 처리",
      description: "빠른 임베딩 처리와 실시간 검색 결과 제공"
    },
    {
      icon: FileText,
      title: "컬렉션 관리",
      description: "문서를 주제별로 분류하고 효율적으로 관리"
    }
  ];

  const stats = [
    {
      label: "처리된 문서",
      value: dashboardStats ? dashboardStats.documents.toLocaleString() : "—",
      icon: FileText,
    },
    {
      label: "검색 쿼리",
      value: (dashboardStats ? dashboardStats.queries : 0) + searchCount,
      icon: Search,
    },
    {
      label: "활성 컬렉션",
      value: dashboardStats ? dashboardStats.collections : "—",
      icon: Brain,
    },
    {
      label: "응답 시간",
      value: lastLatencyMs !== null ? `${Math.max(0.1, Math.round(lastLatencyMs / 100) / 10)}초` : "—",
      icon: Zap,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <Header />

      {/* Hero Section */}

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-5xl md:text-6xl font-bold mb-6">
              <span className="gradient-text">AI 기반</span> 문서 검색의
              <br />새로운 패러다임
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Grok API와 Collections를 활용하여 복잡한 문서에서 정확한 답변을 찾아보세요.
              RAG 기술로 환각 없는 신뢰할 수 있는 정보를 제공합니다.
            </p>

            {/* Search Interface */}
            <div className="max-w-2xl mx-auto mb-12">
              <Card className="ai-glow border-primary/20">
                <CardContent className="p-6">
                  <div className="flex flex-col space-y-4">
                    <div className="text-left space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">검색 컬렉션</label>
                      <Select
                        value={selectedCollectionId}
                        onValueChange={(value) => {
                          setSelectedCollectionId(value);
                          localStorage.setItem("rag_collection_id", value);
                        }}
                        disabled={!isLoggedIn || collections.length === 0}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder={collections.length === 0 ? "컬렉션이 없습니다" : "컬렉션 선택"} />
                        </SelectTrigger>
                        <SelectContent>
                          {collections.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                              {typeof c.documents_count === "number" && ` (${c.documents_count}개)`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!isLoggedIn && (
                        <p className="text-xs text-muted-foreground">로그인 후 컬렉션을 선택할 수 있습니다.</p>
                      )}
                      {isLoggedIn && collections.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          컬렉션이 없습니다. 먼저 문서를 업로드해 주세요.
                        </p>
                      )}
                    </div>
                    {collectionSummary && (
                      <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span>문서 {collectionSummary.total}개</span>
                          <span>• 처리완료 {collectionSummary.processed}</span>
                          <span>• 인덱싱 {collectionSummary.processing}</span>
                          <span>• 실패 {collectionSummary.failed}</span>
                        </div>
                        {summaryPolling && (
                          <div className="mt-1 text-xs">
                            인덱싱 중인 문서가 있어 5초마다 상태를 갱신합니다.
                          </div>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 text-left md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">카테고리</label>
                        <Input
                          placeholder="예: 정책, 공고"
                          value={filterCategory}
                          onChange={(e) => setFilterCategory(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">태그</label>
                        <Input
                          placeholder="예: 광주, 특구 (쉼표로 구분)"
                          value={filterTags}
                          onChange={(e) => setFilterTags(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">시작일</label>
                        <Input
                          type="date"
                          value={filterDateFrom}
                          onChange={(e) => setFilterDateFrom(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">종료일</label>
                        <Input
                          type="date"
                          value={filterDateTo}
                          onChange={(e) => setFilterDateTo(e.target.value)}
                        />
                      </div>
                    </div>
                    <Textarea
                      placeholder={isLoggedIn ? "문서에 대해 궁금한 것을 질문해보세요... (예: '프로젝트 예산은 얼마인가요?')" : "검색하려면 로그인이 필요합니다."}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="min-h-[100px] resize-none border-primary/20 focus:border-primary"
                      onClick={() => !isLoggedIn && navigate("/login")}
                    />
                    <Button
                      onClick={handleSearch}
                      disabled={!query.trim() || isSearching}
                      className="w-full bg-gradient-to-r from-primary to-primary-glow hover:from-primary-glow hover:to-primary ai-glow"
                      size="lg"
                    >
                      {isSearching ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                          검색 중...
                        </>
                      ) : (
                        <>
                          <Search className="w-5 h-5 mr-2" />
                          AI 검색 시작
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Answer Section */}
              {response && (
                <div className="mt-8 text-left animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <Card className="border-primary/20 bg-white/50 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center text-lg">
                        <Brain className="w-5 h-5 mr-2 text-primary" />
                        AI 답변
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {response.answer.startsWith("문서가 아직 인덱싱") && (
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                          <div className="flex items-center space-x-3">
                            <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                            <div>
                              <p className="text-sm font-semibold text-primary">인덱싱 진행 중</p>
                              <p className="text-xs text-muted-foreground">문서 처리 중입니다. 완료되면 검색 결과가 자동으로 풍부해집니다.</p>
                            </div>
                          </div>
                          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-primary/10">
                            <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-primary/40 via-primary/70 to-primary/40" />
                          </div>
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">
                        {response.answer}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ※ 이 답변은 문서 내 텍스트와 이미지에서 추출된 텍스트 기반입니다.
                      </div>

                      {response.citations && response.citations.length > 0 && (
                        <div className="mt-4 pt-4 border-t">
                          <h4 className="text-sm font-semibold mb-2 flex items-center text-muted-foreground">
                            <FileText className="w-4 h-4 mr-2" />
                            참고 문서 (Citations)
                          </h4>
                          <div className="grid gap-2">
                            {response.citations.map((cite, idx) => (
                              <div key={idx} className="text-xs bg-muted p-2 rounded flex items-start">
                                <Badge variant="outline" className="mr-2 shrink-0">{idx + 1}</Badge>
                                <div>
                                  <span className="font-medium text-primary block mb-1">
                                    {cite.title || "Untitled Document"}
                                  </span>
                                  <span className="text-muted-foreground line-clamp-2">
                                    {cite.content || cite.snippet}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="text-xs text-right text-muted-foreground pt-2">
                        응답 시간: {response.latency_ms}ms {response.cached && "(캐시됨)"}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
              {stats.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <Card key={index} className="text-center hover:shadow-lg transition-all duration-300">
                    <CardContent className="p-4">
                      <Icon className="w-8 h-8 mx-auto mb-2 text-primary" />
                      <div
                        key={`${index}-${statsTick}`}
                        className="text-2xl font-bold text-primary transition-all duration-500 ease-out animate-in zoom-in-50"
                      >
                        {stat.value}
                      </div>
                      <div className="text-sm text-muted-foreground">{stat.label}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="gradient-text">강력한 기능</span>으로 완성된
            </h3>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              최신 AI 기술과 직관적인 인터페이스로 문서 검색의 새로운 경험을 제공합니다.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card key={index} className="text-center hover:shadow-xl transition-all duration-300 group">
                  <CardHeader>
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center group-hover:scale-110 transition-transform duration-300 ai-glow">
                      <Icon className="w-8 h-8 text-white" />
                    </div>
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Technology Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h3 className="text-3xl md:text-4xl font-bold mb-4">
                <span className="gradient-text">최첨단 기술</span> 스택
              </h3>
              <p className="text-xl text-muted-foreground">
                검증된 AI 기술과 클라우드 인프라로 안정적이고 빠른 서비스를 제공합니다.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <Card className="text-center accent-glow">
                <CardHeader>
                  <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-gradient-to-br from-accent to-accent-glow flex items-center justify-center">
                    <Brain className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle>Grok API</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    xAI의 최신 LLM으로 강력한 추론 능력과 실시간 웹 검색 기능을 제공합니다.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="text-center accent-glow">
                <CardHeader>
                  <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-gradient-to-br from-accent to-accent-glow flex items-center justify-center">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle>Collections API</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    관리형 RAG 서비스로 복잡한 인프라 없이 문서 인덱싱과 검색을 자동화합니다.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="text-center accent-glow">
                <CardHeader>
                  <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-gradient-to-br from-accent to-accent-glow flex items-center justify-center">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle>실시간 처리</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    빠른 임베딩 처리와 하이브리드 검색으로 2초 이내 응답 시간을 보장합니다.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-r from-primary to-primary-glow text-white">
        <div className="container mx-auto text-center">
          <h3 className="text-3xl md:text-4xl font-bold mb-6">
            지금 바로 시작해보세요
          </h3>
          <p className="text-xl mb-8 opacity-90 max-w-2xl mx-auto">
            문서를 업로드하고 AI의 도움으로 필요한 정보를 빠르게 찾아보세요.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              variant="secondary"
              className="bg-white text-primary hover:bg-white/90"
              onClick={() => handleAuthAction(() => navigate("/upload"))}
            >
              <Upload className="w-5 h-5 mr-2" />
              문서 업로드하기
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white text-white hover:bg-white hover:text-primary"
              onClick={() => navigate("/dashboard")}
            >
              <MessageSquare className="w-5 h-5 mr-2" />
              데모 체험하기
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 bg-muted/50">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-3 mb-4 md:mb-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-semibold gradient-text">RAG Search</span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-muted-foreground">
              <span>© 2025 RAG Search</span>
              <Badge variant="secondary">v1.0</Badge>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
