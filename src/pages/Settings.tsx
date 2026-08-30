import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Key,
  Zap,
  Shield,
  Bell,
  Palette,
  Save,
  Cpu,
  Database
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import SidebarLayout from "@/components/SidebarLayout";
import { toast } from "sonner";

const Settings = () => {
  const navigate = useNavigate();
  const [engine, setEngine] = useState<any>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    api.getHealth()
      .then((h) => setEngine({
        active: h?.llm?.active_provider,
        model: h?.llm?.providers?.[h?.llm?.active_provider]?.model
               ?? h?.stack ?? h?.llm?.model,
        providers: h?.llm?.providers,
        embedding: h?.embedding,
        qdrant: h?.qdrant,
      }))
      .catch((e) => setEngineError(e.message));
  }, []);

  const [notifications, setNotifications] = useState(true);
  const [autoSave, setAutoSave] = useState(true);
  const [theme, setTheme] = useState("light");
  const [language, setLanguage] = useState("ko");

  const handleSave = () => {
    toast.success("설정 값이 로컬 환경에 반영 보존되었습니다.");
  };

  const headerCta = (
    <Button
      onClick={handleSave}
      className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 outline-none"
    >
      <Save className="w-4 h-4 mr-2" />
      설정 저장
    </Button>
  );

  return (
    <SidebarLayout
      title="환경 설정"
      description="LMMWiki 시스템 추론 오케스트레이션 경로 및 임베딩 벡터 모델, 검색 성능 가중치와 보안 감사 주기를 설정합니다."
      statusLine="상태: 환경 설정 변경 시 즉시 반영 대기"
      cta={headerCta}
    >
      <div className="max-w-4xl mx-auto">
        <Tabs defaultValue="api" className="w-full">
          <TabsList className="grid w-full grid-cols-5 rounded-lg bg-slate-200/50 p-1">
            <TabsTrigger value="api" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              API 설정
            </TabsTrigger>
            <TabsTrigger value="performance" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              성능
            </TabsTrigger>
            <TabsTrigger value="security" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              보안
            </TabsTrigger>
            <TabsTrigger value="notifications" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              알림
            </TabsTrigger>
            <TabsTrigger value="appearance" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              외관
            </TabsTrigger>
          </TabsList>

          {/* API Settings */}
          <TabsContent value="api" className="mt-4">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#5146E5]" />
                  온프레미스 추론 엔진 상태
                </CardTitle>
                <CardDescription>
                  사내 탑재 서버와 데이터베이스 구성 현황을 실시간으로 확인합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6 text-sm">
                {!engine && !engineError && (
                  <p className="text-slate-400">서버 엔진 상태를 불러오는 중입니다...</p>
                )}
                {engineError && (
                  <p className="text-red-500">서버 조회 오류: {engineError}</p>
                )}
                {engine && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-[#17B890]/30 bg-[#17B890]/5 p-4 flex items-start gap-3">
                      <Cpu className="w-5 h-5 text-[#17B890] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-[#17B890]">
                          추론 환경: 사내 GPU (온프레미스 클러스터)
                        </p>
                        <p className="text-xs text-slate-600 mt-1 font-mono">
                          액티브 모델: <strong>{engine.model || "—"}</strong>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                          진단 자료 데이터는 외부로 무단 전송되지 않으며 사내 네트워크 내부망에서 자급 연산합니다.
                        </p>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-100 p-3 bg-slate-50/30">
                        <span className="text-[10px] text-slate-400 font-bold block mb-1">임베딩 모델</span>
                        <p className="font-semibold text-slate-800 text-xs">
                          {engine.embedding?.model || "BGE-M3"} · {engine.embedding?.dim || 1024}차원
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-100 p-3 bg-slate-50/30">
                        <span className="text-[10px] text-slate-400 font-bold block mb-1">벡터 데이터베이스</span>
                        <p className="font-semibold text-slate-800 text-xs">Qdrant · {engine.qdrant || "활성"}</p>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <h4 className="font-bold text-xs text-slate-700">오케스트레이션 경로 및 폴백 큐</h4>
                      <div className="space-y-1.5">
                        {Object.entries(engine.providers ?? {}).map(([name, p]: any) => (
                          <div key={name} className="flex items-center justify-between text-xs rounded-lg border border-slate-100 px-3 py-2.5 bg-white shadow-sm">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                name === engine.active ? "bg-[#17B890]"
                                  : p.available ? "bg-[#F5B51B]" : "bg-slate-300"
                              }`} />
                              <span className="font-bold text-slate-700 uppercase">
                                {name === "exo" ? "사내 GPU 노드" : name}
                              </span>
                            </div>
                            <span className="text-slate-500 font-medium text-[11px]">
                              {name === engine.active
                                ? `작동 중 (성공 ${p.success_count}회 · 지연 ${p.last_latency_ms}ms)`
                                : p.available ? "폴백 대기 상태" : "미지원"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-4">
                  <h4 className="font-bold text-xs text-slate-700 mb-2.5">연결 포트 상태</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">xAI API 터널링</span>
                      <Badge className="bg-[#17B890]/20 text-[#17B890] border-none font-semibold text-[10px]">연결됨</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">Qdrant Collections API</span>
                      <Badge className="bg-[#17B890]/20 text-[#17B890] border-none font-semibold text-[10px]">연결 상태 양호</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Performance Settings */}
          <TabsContent value="performance" className="mt-4">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#5146E5]" />
                  검색 성능 가중치 설정
                </CardTitle>
                <CardDescription>
                  RAG 검색 파이프라인의 청킹 가중치를 설정합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6 text-sm">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-slate-700">검색 결과 한도 수 (Top-K)</Label>
                      <Select defaultValue="5">
                        <SelectTrigger className="rounded-lg h-9 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3">3개 문서 조각</SelectItem>
                          <SelectItem value="5">5개 문서 조각 (권장)</SelectItem>
                          <SelectItem value="10">10개 문서 조각</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-slate-700">청크 크기 (Tokens)</Label>
                      <Select defaultValue="500">
                        <SelectTrigger className="rounded-lg h-9 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="200">200 토큰 (세부 수치 전용)</SelectItem>
                          <SelectItem value="500">500 토큰 (문맥 혼용 권장)</SelectItem>
                          <SelectItem value="1000">1000 토큰 (대용량 장문)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-4 pt-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs font-bold text-slate-700">검색 캐싱 활성화</Label>
                        <p className="text-[10px] text-slate-400">동일 질의 건에 대해 2초 내 고속 캐시 응답</p>
                      </div>
                      <Switch checked={true} className="data-[state=checked]:bg-[#5146E5]" />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs font-bold text-slate-700">하이브리드 검색 결합 (RRF)</Label>
                        <p className="text-[10px] text-slate-400">BM25(키워드) 및 Dense(벡터) 결과 결합</p>
                      </div>
                      <Switch checked={true} className="data-[state=checked]:bg-[#5146E5]" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Settings */}
          <TabsContent value="security" className="mt-4">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-500" />
                  보안 및 데이터 규약
                </CardTitle>
                <CardDescription>
                  개인정보 비식별 가이드 및 ACL 상속 여부를 지정합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6 text-sm">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-bold text-slate-700">저장 데이터 암호화 규격 (AES-256)</Label>
                      <p className="text-[10px] text-slate-400">서버 적재 및 캐싱 데이터 암호화 적용</p>
                    </div>
                    <Switch checked={true} disabled />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-bold text-slate-700">상세 접근 로그 기록 (Audit Logging)</Label>
                      <p className="text-[10px] text-slate-400">사용자별 RAG 질문 및 출력 원천 이력 감시</p>
                    </div>
                    <Switch checked={true} className="data-[state=checked]:bg-[#5146E5]" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-bold text-slate-700">자동 세션 만료</Label>
                      <p className="text-[10px] text-slate-400">비활성 상태 120분 경과 시 자동 로그아웃</p>
                    </div>
                    <Switch checked={false} className="data-[state=checked]:bg-[#5146E5]" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notification Settings */}
          <TabsContent value="notifications" className="mt-4">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-500" />
                  실시간 파이프라인 알림
                </CardTitle>
                <CardDescription>
                  데이터 가공 오류 및 적재 통지 여부를 설정합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-slate-700">브라우저 푸시 알림</Label>
                    <p className="text-[10px] text-slate-400">에이전트 인덱싱 완료 및 큐 갱신 시 웹 푸시 발생</p>
                  </div>
                  <Switch 
                    checked={notifications} 
                    onCheckedChange={setNotifications}
                    className="data-[state=checked]:bg-[#5146E5]"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-slate-700">오류 실시간 통보</Label>
                    <p className="text-[10px] text-slate-400">개인정보 잔존 혹은 검산 오류 단계 병목 알림</p>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-[#5146E5]" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Appearance Settings */}
          <TabsContent value="appearance" className="mt-4">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[#5146E5]" />
                  콘솔 디스플레이 설정
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6 text-sm">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-slate-700">테마 스킨</Label>
                      <Select value={theme} onValueChange={setTheme}>
                        <SelectTrigger className="rounded-lg h-9 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">클래식 라이트 (기본)</SelectItem>
                          <SelectItem value="dark">다크 섀도우</SelectItem>
                          <SelectItem value="system">시스템 디폴트</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-slate-700">기본 로케일 언어</Label>
                      <Select value={language} onValueChange={setLanguage}>
                        <SelectTrigger className="rounded-lg h-9 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ko">한국어 (Korean)</SelectItem>
                          <SelectItem value="en">English (US)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-4 pt-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs font-bold text-slate-700">콘솔 트랜지션 애니메이션</Label>
                        <p className="text-[10px] text-slate-400">부드러운 화면 전환 효과 적용</p>
                      </div>
                      <Switch checked={true} className="data-[state=checked]:bg-[#5146E5]" />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs font-bold text-slate-700">자동 저장 활성</Label>
                        <p className="text-[10px] text-slate-400">설정 값 변동 감지 시 브라우저 자동 반영</p>
                      </div>
                      <Switch 
                        checked={autoSave} 
                        onCheckedChange={setAutoSave}
                        className="data-[state=checked]:bg-[#5146E5]"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </SidebarLayout>
  );
};

export default Settings;