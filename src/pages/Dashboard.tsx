import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileText,
  Search,
  Zap,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  X,
  UserCheck,
  Binary
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import SidebarLayout from "@/components/SidebarLayout";

interface PendingItem {
  id: string;
  name: string;
  sector: string;
  sectorName: string;
  pagesCount: number;
  piiResidual: number;
  verificationStatus: "success" | "warning" | "error";
  verificationMsg: string;
  version: string;
  hash: string;
  reviewer: string;
  evidence: string[];
}

export const Dashboard = () => {
  const navigate = useNavigate();
  const [realCollections, setCollections] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [pendingList, setPendingList] = useState<PendingItem[]>([]);

  const [dashboardStats, setStats] = useState<any>({
    collections: 0,
    documents: 0,
    queries: 0,
    avg_latency_ms: 0,
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

    // Mock pending verification items for Wiki Admin queue
    setPendingList([
      {
        id: "dgn-2026-hanbit",
        name: "한빛제지 보일러실 에너지 진단 보고서",
        sector: "industrial",
        sectorName: "산업체 및 제조공장",
        pagesCount: 48,
        piiResidual: 0,
        verificationStatus: "success",
        verificationMsg: "검산 완료 (100% 정합)",
        version: "v3.1",
        hash: "sha256:9f2c1a84f32c...",
        reviewer: "김현우 책임연구원",
        evidence: [
          "p.47: 배가스 온도 실측치 210°C 확인 (수치 검산 통과)",
          "p.48: 급수온도 60°C 이하 적합성 판정",
          "p.52: 연료단가 2026Q1 단가 데이터 정합성 대조 완료"
        ]
      },
      {
        id: "dgn-2026-glotech",
        name: "글로텍(주) HVAC 개선 실사 보고서",
        sector: "industrial",
        sectorName: "산업체 및 제조공장",
        pagesCount: 32,
        piiResidual: 2,
        verificationStatus: "warning",
        verificationMsg: "주의: 잔존 개인식별정보 PII 검출",
        version: "v1.2",
        hash: "sha256:7f4c51b22e11...",
        reviewer: "이민아 수석연구원",
        evidence: [
          "p.12: 공정 책임자 연락처(010-****-****) 비식별 치환 대기 중",
          "p.18: 설비 가동량 대비 인버터 제어 35Hz 산출식 보완 요망"
        ]
      },
      {
        id: "dgn-2026-seoulsquare",
        name: "서울스퀘어 빌딩 흡수식 냉동기 실사서",
        sector: "building",
        sectorName: "건물 및 공공기관",
        pagesCount: 56,
        piiResidual: 0,
        verificationStatus: "error",
        verificationMsg: "에러: 원단위 누락 항목 존재",
        version: "v2.0",
        hash: "sha256:c22c1b18d844...",
        reviewer: "박동진 연구원",
        evidence: [
          "p.22: 필수 지표 냉동기 흡수액 농도 실측값 누락 감지",
          "p.25: 기준 냉수 온도가 법정 최저 기준(5°C) 미만으로 표기 오류"
        ]
      }
    ]);
  }, []);

  const handleApprove = (id: string) => {
    toast.success("해당 진단 보고서가 최종 승인 및 마스터 위키(SSOT)에 병합 배포되었습니다.");
    setPendingList(prev => prev.filter(item => item.id !== id));
    setSelectedItem(null);
  };

  const handleReject = (id: string) => {
    toast.info("승인이 보류되고 보완 검토 로그가 백업되었습니다.");
    setSelectedItem(null);
  };

  const handleOpenQueue = () => {
    setIsQueueOpen(true);
    toast.success("총 3건의 검증 대기 큐 항목을 활성화했습니다.");
  };

  const getStatusIcon = (status: "success" | "warning" | "error") => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-[#17B890]" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-[#F5B51B]" />;
      default:
        return <XCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusBadgeStyle = (status: "success" | "warning" | "error") => {
    switch (status) {
      case "success":
        return "bg-[#17B890]/20 text-[#17B890] border-none";
      case "warning":
        return "bg-[#F5B51B]/20 text-[#F5B51B] border-none";
      default:
        return "bg-red-100 text-red-700 border-none";
    }
  };

  return (
    <SidebarLayout
      title="검토·승인"
      description="파이프라인 단계별 완료율과 오류 현황을 관리하고, 추출된 위키 문서의 서명·버전·수치 근거를 상세 검증하여 마스터 위키에 정식 배포합니다."
      statusLine={
        `검증 큐 대기: ${pendingList.length}건 (수치 검산 확인 필요: 17건 감지)`
      }
      cta={
        <Button
          onClick={handleOpenQueue}
          className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 transition-all outline-none"
        >
          검증 큐 열기
        </Button>
      }
    >
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* Pipeline KPI Cards - 3 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: 위키 생성 */}
          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
            <CardHeader className="py-4 bg-slate-50/40 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">KPI 01 / 위키 생성</span>
                <Badge className="bg-[#17B890]/20 text-[#17B890] border-none text-[10px]">완료</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-1">
              <p className="text-3xl font-black text-slate-800">67 Page</p>
              <p className="text-xs text-slate-500 font-medium">최종 동기화: 2분 전 완료</p>
              <p className="text-[10px] text-slate-400 pt-2 border-t mt-3">신규 수집된 텍스트/표의 위키 페이지 매핑</p>
            </CardContent>
          </Card>

          {/* Card 2: 수치 검산 */}
          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
            <CardHeader className="py-4 bg-slate-50/40 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">KPI 02 / 수치 검산</span>
                <Badge className="bg-[#F5B51B]/20 text-[#F5B51B] border-none text-[10px]">확인 필요</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-1">
              <p className="text-3xl font-black text-slate-800">17 건</p>
              <p className="text-xs text-slate-500 font-medium hover:text-[#5146E5] cursor-pointer" onClick={handleOpenQueue}>
                세부 검토 큐로 이동 →
              </p>
              <p className="text-[10px] text-slate-400 pt-2 border-t mt-3">에너지 환산계수 대조 및 이상치 오차 발생 검토</p>
            </CardContent>
          </Card>

          {/* Card 3: 배포 판단 */}
          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
            <CardHeader className="py-4 bg-slate-50/40 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">KPI 03 / 배포 판단</span>
                <Badge className="bg-[#F5B51B]/20 text-[#F5B51B] border-none text-[10px]">검토 중</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-1">
              <p className="text-3xl font-black text-slate-800">50 / 17 건</p>
              <p className="text-xs text-slate-500 font-medium">50건 정식 승인 완료 · 17건 초안(Draft) 보류</p>
              <p className="text-[10px] text-slate-400 pt-2 border-t mt-3">마스터 위키 자동 커밋 대기 및 분기 상태</p>
            </CardContent>
          </Card>
        </div>

        {/* 5-Step Progress Ribbon Visualization */}
        <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
          <CardHeader className="py-3.5 px-5 bg-slate-50/40 border-b border-slate-100">
            <CardTitle className="text-sm font-bold text-slate-800">데이터 처리 파이프라인 진행 상태 리본</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {/* Visual Progress Ribbon layout */}
            <div className="flex flex-col lg:flex-row items-center justify-between gap-3 text-xs">
              
              {/* Step 1 */}
              <div className="flex-1 w-full bg-[#17B890] text-white rounded-lg p-3 flex flex-col justify-between h-20 shadow-[0_4px_10px_rgba(23,184,144,0.15)]">
                <div className="flex justify-between font-bold">
                  <span>1. 업로드 (Upload)</span>
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex justify-between text-[10px] opacity-90 mt-2">
                  <span>완료율: 100%</span>
                  <span>에러 0건</span>
                </div>
              </div>

              <ChevronRight className="hidden lg:block w-4 h-4 text-slate-300" />

              {/* Step 2 */}
              <div className="flex-1 w-full bg-[#17B890] text-white rounded-lg p-3 flex flex-col justify-between h-20 shadow-[0_4px_10px_rgba(23,184,144,0.15)]">
                <div className="flex justify-between font-bold">
                  <span>2. 추출 (Extract)</span>
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex justify-between text-[10px] opacity-90 mt-2">
                  <span>완료율: 98%</span>
                  <span>에러 2건</span>
                </div>
              </div>

              <ChevronRight className="hidden lg:block w-4 h-4 text-slate-300" />

              {/* Step 3 */}
              <div className="flex-1 w-full bg-[#17B890] text-white rounded-lg p-3 flex flex-col justify-between h-20 shadow-[0_4px_10px_rgba(23,184,144,0.15)]">
                <div className="flex justify-between font-bold">
                  <span>3. 분류 (Classify)</span>
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex justify-between text-[10px] opacity-90 mt-2">
                  <span>완료율: 95%</span>
                  <span>에러 1건</span>
                </div>
              </div>

              <ChevronRight className="hidden lg:block w-4 h-4 text-slate-300" />

              {/* Step 4 */}
              <div className="flex-1 w-full bg-[#F5B51B] text-amber-950 rounded-lg p-3 flex flex-col justify-between h-20 shadow-[0_4px_10px_rgba(245,181,27,0.15)]">
                <div className="flex justify-between font-bold">
                  <span>4. 검산 (Verify)</span>
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex justify-between text-[10px] opacity-90 mt-2">
                  <span>완료율: 80%</span>
                  <span className="font-bold">검토대기 17건</span>
                </div>
              </div>

              <ChevronRight className="hidden lg:block w-4 h-4 text-slate-300" />

              {/* Step 5 */}
              <div className="flex-1 w-full bg-slate-200 text-slate-500 rounded-lg p-3 flex flex-col justify-between h-20 border border-slate-300/30">
                <div className="flex justify-between font-bold">
                  <span>5. 승인 (Approve)</span>
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex justify-between text-[10px] mt-2">
                  <span>대기 상태</span>
                  <span>배포 대기</span>
                </div>
              </div>

            </div>
          </CardContent>
        </Card>

        {/* Master Queue List & Side Detail Panel Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          
          {/* Left Column: pending queue table */}
          <div className="xl:col-span-2">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50 py-3.5 px-5">
                <CardTitle className="text-base font-bold text-slate-800">
                  승인 검증 대기 큐 (Review Waiting Queue)
                </CardTitle>
                <CardDescription>
                  추출 파이프라인을 마치고 최종 SSOT 위키 병합을 위해 감시 대기 중인 문서 리스트입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {pendingList.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">
                    현재 검토 및 대기 중인 큐 항목이 없습니다.
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-slate-50/40">
                      <TableRow className="border-b border-slate-100">
                        <TableHead className="w-2/5 font-semibold text-slate-700">문서 명칭</TableHead>
                        <TableHead className="font-semibold text-slate-700">부문</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-center">페이지</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-center">PII 잔존</TableHead>
                        <TableHead className="font-semibold text-slate-700">검증 가검산</TableHead>
                        <TableHead className="text-right font-semibold text-slate-700 pr-5">액션</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingList.map((item) => (
                        <TableRow
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className={`cursor-pointer hover:bg-slate-50 border-b border-slate-100 transition-all ${
                            selectedItem?.id === item.id ? "bg-indigo-50/40" : ""
                          }`}
                        >
                          <TableCell className="font-bold text-slate-800 pl-5">
                            {item.name}
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-[#5146E5]/10 text-[#5146E5] border-none font-semibold text-[10px]">
                              {item.sectorName}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-semibold text-slate-600">{item.pagesCount}p</TableCell>
                          <TableCell className="text-center">
                            <span className={item.piiResidual > 0 ? "text-red-500 font-bold text-xs animate-pulse" : "text-slate-400 font-medium text-xs"}>
                              {item.piiResidual}건
                            </span>
                          </TableCell>
                          <TableCell className="font-medium text-slate-600">
                            <div className="flex items-center gap-1.5 text-xs">
                              {getStatusIcon(item.verificationStatus)}
                              <span className="truncate max-w-[130px]">{item.verificationMsg}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-5">
                            <Button
                              variant="ghost"
                              className="h-8 text-xs font-bold text-[#5146E5] hover:bg-indigo-50 rounded-lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedItem(item);
                              }}
                            >
                              검토 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: details panel or side details */}
          <div className="xl:col-span-1">
            {selectedItem ? (
              <Card className="rounded-xl border border-indigo-100 shadow-lg bg-white overflow-hidden animate-in slide-in-from-right-4 duration-300 sticky top-4">
                <CardHeader className="border-b border-indigo-50 bg-indigo-50/10 py-3.5 px-5 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-800">우측 상세 검증 패널</CardTitle>
                    <CardDescription className="text-xs text-[#5146E5]">서명 및 수치 근거 비교 감사</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600 rounded-full"
                    onClick={() => setSelectedItem(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent className="p-5 space-y-4 text-xs">
                  
                  {/* Document general info */}
                  <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <p className="font-bold text-slate-800 text-sm leading-normal">{selectedItem.name}</p>
                    <p className="text-[10px] text-slate-400 font-semibold">{selectedItem.sectorName}</p>
                  </div>

                  {/* Reviewer Signature (서명) */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">인증 서명 (Signature)</span>
                    <div className="rounded-lg border border-slate-100 p-2.5 flex items-center justify-between text-slate-700 bg-white">
                      <div className="flex items-center gap-1.5 font-bold">
                        <UserCheck className="w-4 h-4 text-[#17B890]" />
                        <span>{selectedItem.reviewer}</span>
                      </div>
                      <Badge className="bg-[#17B890]/25 text-[#17B890] border-none font-semibold text-[9px]">서명 검증됨</Badge>
                    </div>
                  </div>

                  {/* Version & Hash (버전) */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">버전 및 데이터 해시 (Version/Hash)</span>
                    <div className="rounded-lg border border-slate-100 p-2.5 space-y-1 font-mono text-[10px] text-slate-600 bg-white leading-normal">
                      <div className="flex justify-between">
                        <span className="font-bold">배포 버전:</span>
                        <span className="text-slate-800 font-bold">{selectedItem.version}</span>
                      </div>
                      <div className="flex justify-between truncate">
                        <span className="font-bold">해시:</span>
                        <span className="text-slate-500 font-medium truncate max-w-[120px]">{selectedItem.hash}</span>
                      </div>
                    </div>
                  </div>

                  {/* Primary Source Evidence (근거) */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">원천 텍스트 근거 (Evidence)</span>
                    <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/40 p-2.5 max-h-40 overflow-y-auto leading-relaxed">
                      {selectedItem.evidence.map((ev, i) => (
                        <div key={i} className="flex gap-1.5 text-slate-600">
                          <span className="text-indigo-600 font-bold shrink-0">·</span>
                          <p>{ev}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Severity Warnings notice */}
                  {selectedItem.piiResidual > 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[10px] text-red-800 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">보안 정책 위반 경고</p>
                        <p className="mt-0.5">개인정보 잔존 건수가 존재합니다. 최종 승인 전 비식별 처리가 완료되었는지 또는 예외 사례인지 보안 검토가 요구됩니다.</p>
                      </div>
                    </div>
                  )}

                  {/* Action controls */}
                  <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                    <Button
                      onClick={() => handleApprove(selectedItem.id)}
                      disabled={selectedItem.verificationStatus === "error"}
                      className="flex-1 bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-bold rounded-lg h-9"
                    >
                      최종 승인 및 배포
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleReject(selectedItem.id)}
                      className="rounded-lg h-9 border-slate-200 text-slate-600 bg-white"
                    >
                      반려
                    </Button>
                  </div>
                  {selectedItem.verificationStatus === "error" && (
                    <p className="text-[9px] text-red-500 font-medium text-center">
                      ⚠️ 치명적인 데이터 에러 검출 상태이므로 승인이 비활성화됩니다.
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center min-h-[300px]">
                <ShieldCheck className="w-8 h-8 text-slate-300 mb-2" />
                <p className="font-semibold text-slate-600">상세 검토 항목이 선택되지 않았습니다.</p>
                <p className="mt-0.5">대기 큐 목록에서 임의의 진단 문서를 클릭하여 서명·버전·근거 정합성을 감사하세요.</p>
              </div>
            )}
          </div>

        </div>

      </div>
    </SidebarLayout>
  );
};

export default Dashboard;
