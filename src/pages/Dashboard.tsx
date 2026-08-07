import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  ArrowLeft,
  FileText,
  Search,
  Zap,
  TrendingUp,
  Users,
  Clock,
  Activity
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import Header from "@/components/Header";

const CollectionItem = ({ collection }: { collection: any }) => {
  const [expanded, setExpanded] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleExpand = async (e: React.MouseEvent) => {
    // Prevent toggling when clicking action buttons
    if ((e.target as HTMLElement).closest('button')) return;

    if (!expanded && documents.length === 0) {
      setLoading(true);
      try {
        const docs = await api.getDocuments(collection.id);
        setDocuments(docs);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const handleDelete = async (docId: number) => {
    if (!confirm("정말로 이 문서를 삭제하시겠습니까?")) return;
    try {
      await api.deleteDocument(docId);
      setDocuments(documents.filter(d => d.id !== docId));
      alert("문서가 삭제되었습니다.");
    } catch (e) {
      alert("삭제 실패");
    }
  };

  const handleDeleteCollection = async () => {
    if (!confirm(`'${collection.name}' 컬렉션을 삭제하시겠습니까?\n포함된 모든 문서가 함께 삭제됩니다.`)) return;
    try {
      await api.deleteCollection(collection.id);
      window.location.reload(); // Simple reload to refresh list
    } catch (e) {
      alert("컬렉션 삭제 실패");
    }
  };

  return (
    <div className="bg-muted/50 rounded-lg overflow-hidden transition-all duration-300">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/80"
        onClick={toggleExpand}
      >
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h4 className="font-medium">{collection.name}</h4>
            <p className="text-sm text-muted-foreground">
              {collection.documents}개 문서 • {collection.status === 'active' ? '활성' : '처리중'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={handleDeleteCollection} className="text-red-500 hover:text-red-600">
            삭제
          </Button>
          <Badge variant="outline">{expanded ? '접기' : '상세보기'}</Badge>
        </div>
      </div>

      {expanded && (
        <div className="p-4 border-t bg-background/50">
          <h5 className="text-sm font-semibold mb-3">문서 목록</h5>
          {loading ? (
            <div className="text-sm text-muted-foreground">로딩중...</div>
          ) : documents.length > 0 ? (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between p-2 bg-white rounded border text-sm">
                  <div className="flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-muted-foreground" />
                    <span className="truncate max-w-[200px]">{doc.name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString()}</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc.id);
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">문서가 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();

  const [realCollections, setCollections] = useState<any[]>([]);
  const [dashboardStats, setStats] = useState<any>({
    collections: 0,
    documents: 0,
    users: 0,
    queries: 0,
    avg_latency_ms: 0,
    cost_usd: 0
  });

  useEffect(() => {
    // Fetch stats
    api.getStats().then(data => {
      if (data) setStats(data);
    });

    // Fetch collections
    api.getCollections().then(data => {
      setCollections(data);
    });
  }, []);

  // Use real data or fallback
  const displayCollections = realCollections.length > 0 ? realCollections.map(c => ({
    id: c.id,
    name: c.name,
    documents: typeof c.documents_count === "number" ? c.documents_count : "-",
    queries: "-",
    lastUpdated: new Date(c.created_at).toLocaleDateString(),
    status: c.status || "active"
  })) : [];

  // NOTE: recentQueries is hardcoded for now as backend doesn't return query history
  const recentQueries = [
    {
      query: "휴가 정책에 대해 알려주세요",
      collection: "회사 정책 문서",
      timestamp: "5분 전",
      responseTime: "1.2초"
    },
    {
      query: "서버 설정 방법은?",
      collection: "기술 매뉴얼",
      timestamp: "12분 전",
      responseTime: "0.8초"
    },
    {
      query: "계약서 작성 가이드",
      collection: "법률 자료",
      timestamp: "25분 전",
      responseTime: "1.5초"
    }
  ];

  const statsList = [
    {
      title: "총 문서 수",
      value: dashboardStats.documents.toLocaleString(),
      change: "+12%",
      icon: FileText,
      color: "text-blue-600"
    },
    {
      title: "이번 주 검색",
      value: dashboardStats.queries.toLocaleString(),
      change: "+23%",
      icon: Search,
      color: "text-green-600"
    },
    {
      title: "평균 응답시간",
      value: `${Math.max(0.1, Math.round((dashboardStats.avg_latency_ms || 0) / 100) / 10)}초`,
      change: "-15%",
      icon: Zap,
      color: "text-yellow-600"
    },
    {
      title: "누적 비용",
      value: `$${(dashboardStats.cost_usd || 0).toFixed(4)}`,
      change: "+0%",
      icon: Activity,
      color: "text-purple-600"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <Header />

      <div className="container mx-auto px-4 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statsList.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index} className="hover:shadow-lg transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className={`text-sm ${stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                        {stat.change} 지난주 대비
                      </p>
                    </div>
                    <div className={`p-3 rounded-full bg-muted ${stat.color}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Collections Overview */}
          <div className="lg:col-span-2">
            <Card className="ai-glow border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-primary" />
                  컬렉션 현황
                </CardTitle>
                <CardDescription>
                  등록된 문서 컬렉션과 활동 상태
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {displayCollections.length > 0 ? (
                    displayCollections.map((collection) => (
                      <CollectionItem key={collection.id} collection={collection} />
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      등록된 컬렉션이 없습니다.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Activity className="w-5 h-5 mr-2 text-accent" />
                  최근 활동
                </CardTitle>
                <CardDescription>
                  최근 검색 쿼리 및 응답 시간
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentQueries.map((query, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium line-clamp-2">{query.query}</p>
                          <p className="text-xs text-muted-foreground">{query.collection}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {query.timestamp}
                        </span>
                        <span className="flex items-center">
                          <Zap className="w-3 h-3 mr-1" />
                          {query.responseTime}
                        </span>
                      </div>
                      {index < recentQueries.length - 1 && <hr className="border-muted" />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Performance Analytics */}
        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <TrendingUp className="w-5 h-5 mr-2 text-primary" />
                성능 분석
              </CardTitle>
              <CardDescription>
                시스템 성능 지표 및 사용 패턴 분석
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="queries" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="queries">검색 트렌드</TabsTrigger>
                  <TabsTrigger value="performance">응답 성능</TabsTrigger>
                  <TabsTrigger value="usage">사용 패턴</TabsTrigger>
                </TabsList>

                <TabsContent value="queries" className="mt-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-medium">일별 검색 수</h4>
                      <div className="h-32 bg-muted/30 rounded-lg flex items-center justify-center">
                        <p className="text-muted-foreground">차트 영역 (백엔드 연동 후 구현)</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-medium">인기 검색어</h4>
                      <div className="space-y-2">
                        {["휴가 정책", "서버 설정", "계약서 작성", "보안 가이드"].map((term, index) => (
                          <div key={index} className="flex items-center justify-between">
                            <span className="text-sm">{term}</span>
                            <Badge variant="secondary">{Math.floor(Math.random() * 100) + 10}회</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="performance" className="mt-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-medium">응답 시간 분포</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">&lt; 1초</span>
                          <div className="flex items-center space-x-2">
                            <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="w-3/4 h-full bg-green-500"></div>
                            </div>
                            <span className="text-sm text-muted-foreground">75%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">1-2초</span>
                          <div className="flex items-center space-x-2">
                            <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="w-1/5 h-full bg-yellow-500"></div>
                            </div>
                            <span className="text-sm text-muted-foreground">20%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">&gt; 2초</span>
                          <div className="flex items-center space-x-2">
                            <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="w-1/20 h-full bg-red-500"></div>
                            </div>
                            <span className="text-sm text-muted-foreground">5%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-medium">검색 정확도</h4>
                      <div className="text-center">
                        <div className="text-3xl font-bold text-primary mb-2">94.2%</div>
                        <p className="text-sm text-muted-foreground">평균 검색 정확도</p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="usage" className="mt-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-medium">시간대별 사용량</h4>
                      <div className="h-32 bg-muted/30 rounded-lg flex items-center justify-center">
                        <p className="text-muted-foreground">시간대별 차트 (백엔드 연동 후 구현)</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="font-medium">컬렉션별 사용률</h4>
                      <div className="space-y-2">
                        {displayCollections.length > 0 ? (
                          displayCollections.map((collection, index) => (
                            <div key={index} className="flex items-center justify-between">
                              <span className="text-sm">{collection.name}</span>
                              <div className="flex items-center space-x-2">
                                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary"
                                    style={{ width: "20%" }}
                                  ></div>
                                </div>
                                <span className="text-sm text-muted-foreground">-</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground">데이터 없음</div>
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
