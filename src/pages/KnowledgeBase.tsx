import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Database, FileText, Table as TableIcon, Image as ImageIcon, FileSpreadsheet,
    ShieldAlert, ShieldCheck, Network, Upload, Loader2, AlertTriangle,
    CheckCircle2, Info, XCircle, Factory, Download, BookOpen, ExternalLink,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SidebarLayout from "@/components/SidebarLayout";
import ExpandableNotice from "@/components/ExpandableNotice";
import { api, KbSector, KbAnalysis, KbFinding, WikiStatus, WikiSaveResult } from "@/lib/api";

const SEVERITY_STYLE: Record<string, { badge: string; icon: React.ElementType; label: string }> = {
    blocker: { badge: "bg-red-600 text-white border-none", icon: XCircle, label: "차단" },
    error: { badge: "bg-orange-500 text-white border-none", icon: AlertTriangle, label: "위반" },
    warning: { badge: "bg-amber-400 text-amber-950 border-none", icon: AlertTriangle, label: "주의" },
    info: { badge: "bg-slate-500 text-white border-none", icon: Info, label: "확인" },
};

const CHANNEL_META = [
    { key: "text", label: "글", icon: FileText, desc: "문단·서술" },
    { key: "table", label: "표", icon: TableIcon, desc: "모든 수치의 출처" },
    { key: "image", label: "그림", icon: ImageIcon, desc: "사진·도면·차트" },
    { key: "excel", label: "엑셀", icon: FileSpreadsheet, desc: "표 전체 시트" },
];

const KnowledgeBase = () => {
    const navigate = useNavigate();
    const fileRef = useRef<HTMLInputElement>(null);

    const [sectors, setSectors] = useState<KbSector[]>([]);
    const [sector, setSector] = useState<string>("__auto__");
    const [file, setFile] = useState<File | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<KbAnalysis | null>(null);
    const [channelOpen, setChannelOpen] = useState<string | null>(null);
    const [wiki, setWiki] = useState<WikiStatus | null>(null);
    const [site, setSite] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState<WikiSaveResult | null>(null);

    useEffect(() => {
        if (!localStorage.getItem("token")) {
            navigate("/login");
            return;
        }
        api.kbGetSectors()
            .then((d) => setSectors(d.sectors))
            .catch((e) => toast.error(`업종 목록을 불러오지 못했습니다: ${e.message}`));
        api.kbWikiStatus().then(setWiki).catch(() => setWiki({ enabled: false, reason: "연결 실패" }));
    }, [navigate]);

    const handleWikiSave = async () => {
        if (!file) return;
        if (!site.trim()) {
            toast.warning("사업장명을 입력하세요 — 위키 문서 식별자의 기준이 됩니다.");
            return;
        }
        setSaving(true);
        setSaved(null);
        try {
            const res = await api.kbWikiSave(
                file,
                site.trim(),
                sector === "__auto__" ? undefined : sector,
            );
            setSaved(res);
            if (res.stored) toast.success(`위키에 저장했습니다 — 페이지 ${res.pages?.length ?? 0}건`);
            else toast.warning(res.skipped || "위키가 저장하지 않았습니다.");
        } catch (e: any) {
            toast.error(`위키 저장 실패: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleAnalyze = async () => {
        if (!file) {
            toast.error("PDF 파일을 선택해 주세요.");
            return;
        }
        setAnalyzing(true);
        setResult(null);
        try {
            const res = await api.kbAnalyze(file, sector === "__auto__" ? undefined : sector);
            setResult(res);
            if (res.needs_review) {
                toast.warning("업종 분류가 확정되지 않았습니다. 직접 지정해 주세요.");
            } else {
                toast.success(`${res.sector_name} 로 분류되었습니다.`);
            }
        } catch (e: any) {
            toast.error(e.message || "분석에 실패했습니다.");
        } finally {
            setAnalyzing(false);
        }
    };

    const downloadGraph = () => {
        if (!result?.graph) return;
        const blob = new Blob([JSON.stringify(result.graph, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${result.doc_hash}_ontology.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const findings: KbFinding[] = result?.compliance?.findings ?? [];
    const counts = result?.compliance?.counts ?? {};

    // Header CTA Button configuration
    const headerCta = result && wiki?.enabled ? (
        <Button
            onClick={handleWikiSave}
            disabled={saving || !file || !site.trim()}
            className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 outline-none"
        >
            {saving ? (
                <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    저장 중…
                </>
            ) : (
                <>
                    <BookOpen className="h-4 w-4 mr-2" />
                    위키 저장하기
                </>
            )}
        </Button>
    ) : result ? (
        <Button
            onClick={handleAnalyze}
            disabled={analyzing || !file}
            className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 outline-none"
        >
            재분석 실행
        </Button>
    ) : (
        <Button
            onClick={handleAnalyze}
            disabled={analyzing || !file}
            className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 outline-none"
        >
            {analyzing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />분석 중</> : "분석 시작"}
        </Button>
    );

    return (
        <SidebarLayout
            title="보고서 지식화"
            description="진단 보고서를 문단·표·그림 단위로 정밀 분석하여 업종 자동 분류, 필수 지표 커버리지 준수성 검토 및 온톨로지 지식을 추출합니다."
            statusLine={
                result
                    ? `대상 파일: ${result.filename} (${result.sector_name})`
                    : "상태: 분석 대기 중 (PDF 문서를 분석하여 위키 구조화 데이터로 변환)"
            }
            cta={headerCta}
        >
            <div className="max-w-[1400px] mx-auto space-y-6">
                
                {/* AI Act collapsible warning */}
                <ExpandableNotice summary="🤖 본 기능은 생성형 AI 기술을 활용하여 온톨로지를 추출합니다. (인공지능 기본법 제31조 사전 고지)">
                    본 시스템이 생성하는 텍스트 및 수치 추출 결과에는 AI 생성 라벨이 자동으로 부여되며,
                    정적 검증 규칙(calc_ecm.py)에 의한 사후 검산 과정을 포함하고 있습니다.
                    최종 승인 및 배포 여부에 관한 법적·사무적 책임은 진단 전문가 및 검토 담당자에게 있습니다.
                </ExpandableNotice>

                {/* Core Task Card: PDF Parse Form */}
                <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
                    <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                        <CardTitle className="text-base font-bold text-slate-800">문서 정밀 분석 설정</CardTitle>
                        <CardDescription>
                            로컬 PDF 파일을 선택하고 타겟 업종을 지정하여 규제 검토 및 온톨로지 지식 추출을 실행합니다. (이 단계에서는 업로드되지 않음)
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="grid gap-4 md:grid-cols-[1fr_300px_auto] items-end">
                            <div
                                className="border-2 border-dashed border-slate-200 rounded-xl px-4 py-5 text-center cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-all"
                                onClick={() => fileRef.current?.click()}
                            >
                                <Upload className="w-5 h-5 mx-auto mb-2 text-slate-400" />
                                <p className="text-sm font-medium text-slate-700">
                                    {file ? (
                                        <span className="text-[#5146E5] font-semibold">{file.name}</span>
                                    ) : (
                                        "PDF 파일을 이곳에 끌어다 놓거나 선택하세요"
                                    )}
                                </p>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".pdf"
                                    className="hidden"
                                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    <Factory className="w-3.5 h-3.5 text-slate-400" /> 업종 분류 축
                                </label>
                                <Select value={sector} onValueChange={setSector}>
                                    <SelectTrigger className="rounded-lg border-slate-200 h-10 bg-white">
                                        <SelectValue placeholder="자동 분류" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__auto__">자동 분류 (규칙 및 텍스트 기반)</SelectItem>
                                        {sectors.map((s) => (
                                            <SelectItem key={s.code} value={s.code}>
                                                {s.name} ({s.ksic})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button
                                onClick={handleAnalyze}
                                disabled={analyzing || !file}
                                className="h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-6 font-semibold"
                            >
                                {analyzing ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />분석 중</>
                                ) : (
                                    "분석 시작"
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {result && (
                    <>
                        {/* Summary Bar - 4 Cards */}
                        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white">
                                <CardContent className="p-5">
                                    <p className="text-xs font-semibold text-slate-400 mb-1">업종 분류 결과</p>
                                    <p className="text-2xl font-bold text-slate-800">{result.sector_name}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Badge className={`border-none text-xs ${result.needs_review ? "bg-red-100 text-red-700" : "bg-[#17B890]/20 text-[#17B890]"}`}>
                                            {result.needs_review ? "검토 필요" : "분류 확정"}
                                        </Badge>
                                        <span className="text-[11px] text-slate-500 font-medium">
                                            신뢰도 {Math.round((result.classification?.confidence ?? 0) * 100)}%
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white">
                                <CardContent className="p-5">
                                    <p className="text-xs font-semibold text-slate-400 mb-1">필수 지표 커버리지</p>
                                    <p className="text-2xl font-bold text-slate-800">
                                        {Math.round((result.coverage?.coverage ?? 0) * 100)}%
                                    </p>
                                    <Progress value={(result.coverage?.coverage ?? 0) * 100} className="mt-2.5 h-1.5 bg-slate-100" />
                                    <p className="text-[11px] text-slate-500 mt-1.5 font-medium">
                                        필수 {result.coverage?.required ?? 0}개 항목 중 {result.coverage?.present?.length ?? 0}개 수집
                                    </p>
                                </CardContent>
                            </Card>

                            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white">
                                <CardContent className="p-5">
                                    <p className="text-xs font-semibold text-slate-400 mb-1">규제 준수 여부</p>
                                    <p className={`text-2xl font-bold ${result.upload_allowed ? "text-[#17B890]" : "text-red-600"}`}>
                                        {result.compliance?.verdict}
                                    </p>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {Object.entries(counts).map(([sev, n]) => (
                                            <Badge key={sev} className={`text-[10px] ${SEVERITY_STYLE[sev]?.badge}`}>
                                                {SEVERITY_STYLE[sev]?.label} {n as number}
                                            </Badge>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white">
                                <CardContent className="p-5">
                                    <p className="text-xs font-semibold text-slate-400 mb-1">추출 온톨로지</p>
                                    <p className="text-2xl font-bold text-slate-800">{result.graph_stats?.nodes ?? 0} Nodes</p>
                                    <p className="text-[11px] text-slate-500 mt-2.5 font-medium">
                                        관계 엣지 {result.graph_stats?.edges ?? 0}건 · 추출 수치 {result.graph_stats?.quantities ?? 0}건
                                    </p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Gate Status Notice */}
                        <Card className={`rounded-xl border shadow-sm ${result.upload_allowed ? "border-[#17B890]/30 bg-white" : "border-red-200 bg-red-50/10"}`}>
                            <CardContent className="p-4 flex items-start gap-3">
                                {result.upload_allowed ? (
                                    <ShieldCheck className="w-5 h-5 text-[#17B890] shrink-0 mt-0.5" />
                                ) : (
                                    <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                                )}
                                <div className="flex-1 text-sm">
                                    <p className="font-bold text-slate-800">
                                        {result.upload_allowed
                                            ? `개인정보 비식별 및 데이터 규약 통과 — ${result.collection_name} 컬렉션 적재 가능`
                                            : "데이터 적재 차단 — 해결되지 않은 치명적 규제 위반이 감지되었습니다."}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1 leading-normal">
                                        구조 원본 업로드: <strong className={result.upload_allowed_raw ? "text-[#17B890]" : "text-slate-600"}>{result.upload_allowed_raw ? "허용" : "차단"}</strong>
                                        {" · "}
                                        개인식별정보(PII) {result.compliance?.pii_detected ?? 0}건 탐지, {result.masking?.masked_count ?? 0}건 치환 완료, 잔존 {result.masking?.residual_count ?? 0}건
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* LLM Wiki save configurations */}
                        {wiki?.enabled && (
                            <Card className="rounded-xl border border-indigo-200 bg-indigo-50/10 shadow-sm overflow-hidden">
                                <CardContent className="p-5 space-y-4">
                                    <div className="flex items-start gap-3">
                                        <BookOpen className="w-5 h-5 text-[#5146E5] shrink-0 mt-0.5" />
                                        <div className="flex-1 text-sm">
                                            <p className="font-bold text-slate-800">LLM Wiki(work.ets0404.com) 문서화 저장 환경</p>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                지정한 고유 사업장 명칭을 토대로 정규 식별자(stable_id)를 생성하여 진단·설비·개선안 위키 페이지를 빌드합니다. (현재 저장된 총 위키 문서 수: {wiki.pages ?? 0}건)
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-end gap-3 max-w-2xl">
                                        <div className="flex-1 min-w-[200px] space-y-1.5">
                                            <label className="text-xs font-bold text-slate-700">
                                                고유 사업장명 <span className="text-red-500">*</span>
                                            </label>
                                            <Input
                                                value={site}
                                                onChange={(e) => setSite(e.target.value)}
                                                placeholder="예: 글로텍(주) 충주공장"
                                                disabled={saving}
                                                className="rounded-lg border-slate-200 bg-white"
                                            />
                                        </div>
                                        <Button
                                            onClick={handleWikiSave}
                                            disabled={saving || !file || !site.trim()}
                                            className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold rounded-lg px-6 h-10 shadow-sm"
                                        >
                                            {saving ? "위키 페이지 빌드 중…" : "저장하기"}
                                        </Button>
                                        {wiki.public_url && (
                                            <Button variant="outline" className="rounded-lg h-10 border-slate-200 bg-white" asChild>
                                                <a href={wiki.public_url} target="_blank" rel="noopener noreferrer">
                                                    위키 포털 열기 <ExternalLink className="w-3.5 h-3.5 ml-1" />
                                                </a>
                                            </Button>
                                        )}
                                    </div>

                                    {saved && (
                                        <div className={`rounded-lg border p-4 text-sm animate-in fade-in duration-200 ${saved.stored ? "border-emerald-200 bg-emerald-50/30 text-emerald-900" : "border-amber-200 bg-amber-50/30 text-amber-900"}`}>
                                            {saved.stored ? (
                                                <div className="space-y-2">
                                                    <p className="font-bold flex items-center gap-1.5">
                                                        <CheckCircle2 className="w-4 h-4 text-[#17B890]" />
                                                        위키 표준 저장 성공 — 페이지 {saved.pages?.length ?? 0}건 퍼블리시
                                                    </p>
                                                    <ul className="space-y-1 max-h-32 overflow-auto bg-white/50 rounded-lg p-2.5 border border-emerald-100 text-xs font-medium">
                                                        {(saved.pages ?? []).map((pg: any, i: number) => (
                                                            <li key={i} className="flex justify-between">
                                                                <span className="font-mono text-slate-500">{pg.stable_id ?? pg.id}</span>
                                                                <span className="text-slate-800">{pg.title || "제목 없음"}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    {saved.public_url && (
                                                        <a
                                                            href={saved.public_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-xs text-[#5146E5] font-bold underline"
                                                        >
                                                            위키에서 생성 페이지 확인 <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    <p className="font-bold text-amber-800">
                                                        저장 반려 — {saved.skipped ?? "위키 데이터 컨트랙트 규격 미달."}
                                                    </p>
                                                    {saved.gate && (
                                                        <div className="text-xs space-y-1.5 bg-white/60 p-2.5 rounded-lg border border-amber-100">
                                                            <p className="font-semibold text-slate-700">
                                                                잔존 PII 위반 {saved.gate.residual_count ?? 0}건 검출 (저장하려면 잔존 건수가 0이어야 함)
                                                            </p>
                                                            {(saved.gate.residual ?? []).map((r, i) => (
                                                                <p key={i} className="font-mono text-red-700 bg-red-50/50 px-1 py-0.5 rounded">
                                                                    · {r.label}: {r.value}
                                                                </p>
                                                            ))}
                                                            {(saved.gate.findings ?? []).map((f, i) => (
                                                                <p key={`f${i}`} className="text-slate-600">
                                                                    · [{f.severity}] {f.rule} {f.detail}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* 3-Column Layout: Results, Evidence, Logs */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            
                            {/* Column 1: 결과 (Results) - Channel Breakdown & Parsing Logs */}
                            <div className="space-y-6">
                                <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
                                    <CardHeader className="border-b border-slate-100 py-3.5 bg-slate-50/30">
                                        <CardTitle className="text-sm font-bold text-slate-800">1열: 채널 분해 결과</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-4 space-y-4">
                                        <div className="grid grid-cols-2 gap-3">
                                            {CHANNEL_META.map((c) => {
                                                const Icon = c.icon;
                                                const n = c.key === "excel"
                                                    ? result.parse_summary?.tables ?? 0
                                                    : (result.channels as any)?.[c.key] ?? 0;
                                                const items = result.channel_items?.[c.key] ?? [];
                                                const clickable = items.length > 0;
                                                return (
                                                    <div
                                                        key={c.key}
                                                        onClick={() => clickable && setChannelOpen(c.key)}
                                                        className={`rounded-lg border border-slate-100 p-3 flex flex-col justify-between h-24 transition-all ${
                                                            clickable
                                                                ? "cursor-pointer hover:shadow-md hover:border-[#5146E5]/40 hover:bg-slate-50/20"
                                                                : "opacity-60 bg-slate-50/20"
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <Icon className="w-4 h-4 text-[#5146E5]" />
                                                            <span className="text-lg font-bold text-slate-800">{n}</span>
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-semibold text-slate-700">{c.label}</p>
                                                            <p className="text-[10px] text-slate-400">{c.desc}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div className="rounded-lg border border-slate-100 bg-slate-50/30 p-3.5 space-y-2 text-xs text-slate-600">
                                            <p className="font-semibold text-slate-800 mb-1 border-b pb-1">문서 정형 파싱 통계</p>
                                            <p>총 페이지 수: <strong className="text-slate-800">{result.parse_summary?.pages}면</strong></p>
                                            <p>총 글자 수: <strong className="text-slate-800">{result.parse_summary?.text_chars?.toLocaleString()}자</strong></p>
                                            <p>표 개수: <strong className="text-slate-800">{result.parse_summary?.tables}개</strong> ({result.parse_summary?.table_rows}행, 숫자셀 {result.parse_summary?.numeric_cells}개)</p>
                                            <p>그림 개수: <strong className="text-slate-800">{result.parse_summary?.images}개</strong></p>
                                            {(result.parse_summary?.warnings ?? []).map((w: string, i: number) => (
                                                <p key={i} className="text-amber-700 bg-amber-50 p-1 rounded">⚠ {w}</p>
                                            ))}
                                        </div>

                                        {/* Ontology Graph Widget inside Results Column */}
                                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/10 p-3.5 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-indigo-950 flex items-center gap-1">
                                                    <Network className="w-3.5 h-3.5" /> 추출 온톨로지 정보
                                                </span>
                                                <Button variant="ghost" className="h-6 px-1.5 text-[10px] font-bold text-[#5146E5] hover:bg-indigo-50" onClick={downloadGraph}>
                                                    <Download className="w-3 h-3 mr-1" /> JSON 다운
                                                </Button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                                <div className="bg-white p-2 rounded border border-indigo-50/50">
                                                    <span className="text-slate-500 block">노드 타입 분포</span>
                                                    {Object.entries(result.graph_stats?.by_type ?? {}).map(([t, n]) => (
                                                        <div key={t} className="flex justify-between font-mono mt-0.5">
                                                            <span className="truncate max-w-[70px]">{t}</span>
                                                            <span className="font-bold text-indigo-900">{n as number}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="bg-white p-2 rounded border border-indigo-50/50">
                                                    <span className="text-slate-500 block">추출 근거 등급</span>
                                                    {Object.entries(result.graph_stats?.by_derivation ?? {}).map(([t, n]) => (
                                                        <div key={t} className="flex justify-between font-mono mt-0.5">
                                                            <span>{t}</span>
                                                            <span className="font-bold text-indigo-900">{n as number}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Column 2: 근거 (Evidence) - Required Metrics Compliance */}
                            <div className="space-y-6">
                                <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
                                    <CardHeader className="border-b border-slate-100 py-3.5 bg-slate-50/30">
                                        <CardTitle className="text-sm font-bold text-slate-800">2열: 필수 지표 및 근거 수집</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-4 space-y-4">
                                        <div className="border-b pb-2">
                                            <p className="text-xs font-semibold text-slate-400">데이터 컨트랙트 원단위 기준</p>
                                            <p className="text-sm font-bold text-slate-800 mt-0.5">{result.coverage?.unit_basis || "기준 미정"}</p>
                                        </div>

                                        <div className="space-y-2">
                                            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-[#17B890]" /> 추출 및 매핑 성공 지표
                                            </p>
                                            {result.coverage?.present?.length === 0 ? (
                                                <p className="text-xs text-slate-400">성공한 지표가 없습니다.</p>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {result.coverage?.present?.map((m) => (
                                                        <div key={m.code} className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 flex flex-col gap-1 text-xs">
                                                            <div className="flex items-center justify-between font-semibold text-slate-800">
                                                                <span>{m.label}</span>
                                                                <Badge className="bg-[#17B890]/20 text-[#17B890] text-[9px] border-none font-normal">매핑 완료</Badge>
                                                            </div>
                                                            <p className="text-[10px] text-slate-400 font-mono truncate">근거: {m.evidence}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-2 pt-2">
                                            <p className="text-xs font-semibold text-red-500 flex items-center gap-1">
                                                <XCircle className="w-3.5 h-3.5" /> 누락된 필수 식별 지표
                                            </p>
                                            {result.coverage?.missing?.length === 0 ? (
                                                <p className="text-xs text-[#17B890] bg-[#17B890]/10 p-2 rounded-lg font-semibold">
                                                    필수 지표가 모두 정상적으로 식별되었습니다.
                                                </p>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {result.coverage?.missing?.map((m) => (
                                                        <div key={m.code} className="p-2.5 rounded-lg border border-red-100 bg-red-50/10 flex items-center justify-between text-xs text-red-900">
                                                            <span className="font-semibold">{m.label}</span>
                                                            <Badge variant="destructive" className="text-[9px] font-normal border-none">누락</Badge>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Column 3: 로그 (Logs) - Regulation Review Findings */}
                            <div className="space-y-6">
                                <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
                                    <CardHeader className="border-b border-slate-100 py-3.5 bg-slate-50/30">
                                        <CardTitle className="text-sm font-bold text-slate-800">3열: 법규 및 개인정보 준수성 로그</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-4 space-y-4">
                                        <div className="space-y-3">
                                            {findings.length === 0 ? (
                                                <p className="text-xs text-slate-400 py-2">검출된 규제 관련 로그가 없습니다.</p>
                                            ) : (
                                                findings.map((f, i) => {
                                                    const st = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info;
                                                    const Icon = st.icon;
                                                    return (
                                                        <div key={i} className="p-3 bg-white border border-slate-200/80 rounded-lg space-y-1.5 shadow-sm">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Icon className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                                                    <span className="text-xs font-bold text-slate-800">{f.title}</span>
                                                                </div>
                                                                <Badge className={`text-[9px] font-medium ${st.badge}`}>{st.label}</Badge>
                                                            </div>
                                                            <p className="text-[11px] text-slate-500 leading-normal">{f.detail}</p>
                                                            <div className="flex flex-wrap gap-1.5 text-[9px] text-slate-400">
                                                                <span>{f.law} {f.article}</span>
                                                                <span>•</span>
                                                                <code className="bg-slate-100 px-1 rounded text-slate-600">{f.rule}</code>
                                                            </div>
                                                            {f.samples?.length > 0 && (
                                                                <div className="flex flex-wrap gap-1 mt-1 border-t border-slate-100 pt-1.5">
                                                                    {f.samples.map((s, j) => (
                                                                        <code key={j} className="text-[9px] bg-red-50 text-red-800 px-1 rounded font-mono">
                                                                            {s}
                                                                        </code>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {f.remedy && (
                                                                <div className="bg-slate-50 p-1.5 rounded text-[10px] text-slate-600 border-l border-slate-300">
                                                                    <strong>조치사항:</strong> {f.remedy}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                        {result.compliance?.note && (
                                            <p className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">{result.compliance.note}</p>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>

                        </div>

                        <p className="text-[11px] text-slate-400 text-center pt-2">
                            🤖 본 결과는 결정론적 검증 및 Qwen-72B 온톨로지 변환 결과에 기초합니다. (최종 검수 및 정합성 책임은 담당자에게 귀속)
                        </p>
                    </>
                )}

                {/* Dialog for previewing raw chunk files */}
                <Dialog open={!!channelOpen} onOpenChange={(o) => !o && setChannelOpen(null)}>
                    <DialogContent className="max-w-4xl rounded-xl">
                        {(() => {
                            const meta = CHANNEL_META.find((m) => m.key === channelOpen);
                            const items = channelOpen ? (result?.channel_items?.[channelOpen] ?? []) : [];
                            return (
                                <>
                                    <DialogHeader>
                                        <DialogTitle className="text-base font-bold text-slate-800 flex items-center gap-1.5">
                                            {meta && <meta.icon className="w-4 h-4 text-[#5146E5]" />}
                                            {meta?.label} 채널 분해 — {items.length}건
                                        </DialogTitle>
                                        <DialogDescription className="text-xs text-slate-500">
                                            파일명: {result?.filename} {channelOpen === "excel" && " (엑셀 탭은 표 채널과 동기화되어 매핑됩니다)"}
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
                                        {items.length === 0 && (
                                            <p className="text-sm text-slate-400 py-6 text-center">조각 데이터가 존재하지 않습니다.</p>
                                        )}
                                        {items.map((it, i) => (
                                            <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/40 p-3 text-xs leading-relaxed">
                                                <div className="flex items-center gap-2 mb-1.5 text-[10px] text-slate-400 font-semibold border-b border-slate-100 pb-1">
                                                    <span className="text-slate-700">p.{it.page}</span>
                                                    {it.anchor && <span className="font-mono bg-slate-100 px-1 rounded">{it.anchor}</span>}
                                                    {it.numeric != null && <span>숫자셀 {it.numeric}개</span>}
                                                    <span className="ml-auto">{it.chars.toLocaleString()}자</span>
                                                </div>
                                                <pre className="whitespace-pre-wrap break-all text-slate-700 font-sans">
                                                    {it.preview}{it.truncated && " …"}
                                                </pre>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            );
                        })()}
                    </DialogContent>
                </Dialog>
            </div>
        </SidebarLayout>
    );
};

export default KnowledgeBase;
