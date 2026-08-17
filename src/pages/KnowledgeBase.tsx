import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Database, FileText, Table as TableIcon, Image as ImageIcon, FileSpreadsheet,
    ShieldAlert, ShieldCheck, Network, Upload, Loader2, AlertTriangle,
    CheckCircle2, Info, XCircle, Factory, Download,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Header from "@/components/Header";
import { api, KbSector, KbAnalysis, KbFinding } from "@/lib/api";

const SEVERITY_STYLE: Record<string, { badge: string; icon: React.ElementType; label: string }> = {
    blocker: { badge: "bg-red-600 text-white", icon: XCircle, label: "차단" },
    error: { badge: "bg-orange-500 text-white", icon: AlertTriangle, label: "위반" },
    warning: { badge: "bg-amber-400 text-amber-950", icon: AlertTriangle, label: "주의" },
    info: { badge: "bg-slate-500 text-white", icon: Info, label: "확인" },
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

    useEffect(() => {
        if (!localStorage.getItem("token")) {
            navigate("/login");
            return;
        }
        api.kbGetSectors()
            .then((d) => setSectors(d.sectors))
            .catch((e) => toast.error(`업종 목록을 불러오지 못했습니다: ${e.message}`));
    }, [navigate]);

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

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container mx-auto px-4 py-8 space-y-6">
                {/* 제목 */}
                <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Database className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold">지식 데이터베이스 구축</h1>
                        <p className="text-muted-foreground mt-1">
                            문서를 글·표·그림·엑셀 네 채널로 분해하고, 업종별로 분류해 적재합니다.
                            적재 전 개인정보보호법·인공지능 기본법 준수를 검토합니다.
                        </p>
                    </div>
                </div>

                {/* AI기본법 제31조제1항 사전 고지 */}
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>
                        본 기능은 생성형 인공지능을 사용합니다. 산출물에는 AI 생성 표시가 붙으며,
                        최종 판단과 책임은 담당자에게 있습니다.
                        <span className="opacity-70"> (인공지능 기본법 제31조제1항 사전 고지)</span>
                    </p>
                </div>

                {/* 입력 */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">문서 분석</CardTitle>
                        <CardDescription>
                            PDF 를 올리면 파싱 → 업종 분류 → 필수지표 점검 → 규제 검토 → 온톨로지까지 한 번에 돕니다.
                            이 단계에서는 <strong>업로드하지 않습니다.</strong>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-[1fr_260px_auto]">
                            <div
                                className="border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer hover:border-primary/60 transition"
                                onClick={() => fileRef.current?.click()}
                            >
                                <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                                <p className="text-sm">
                                    {file ? (
                                        <span className="font-medium">{file.name}</span>
                                    ) : (
                                        <>PDF 파일을 선택하거나 여기로 끌어 놓으세요</>
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
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Factory className="w-3.5 h-3.5" /> 업종 (분류 축)
                                </label>
                                <Select value={sector} onValueChange={setSector}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="자동 분류" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__auto__">자동 분류 (규칙 기반)</SelectItem>
                                        {sectors.map((s) => (
                                            <SelectItem key={s.code} value={s.code}>
                                                {s.name} ({s.ksic})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    업종이 컬렉션 분리 축입니다. 원단위 기준이 업종마다 달라 섞으면 안 됩니다.
                                </p>
                            </div>

                            <Button onClick={handleAnalyze} disabled={analyzing || !file} className="self-start mt-7">
                                {analyzing ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />분석 중</>
                                ) : (
                                    <>분석 시작</>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {result && (
                    <>
                        {/* 요약 4칸 */}
                        <div className="grid gap-4 md:grid-cols-4">
                            <Card>
                                <CardContent className="pt-6">
                                    <p className="text-xs text-muted-foreground mb-1">업종 분류</p>
                                    <p className="text-xl font-bold">{result.sector_name}</p>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <Badge variant={result.needs_review ? "destructive" : "secondary"}>
                                            {result.needs_review ? "검토 필요" : "확정"}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            신뢰도 {Math.round((result.classification?.confidence ?? 0) * 100)}%
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-6">
                                    <p className="text-xs text-muted-foreground mb-1">필수지표 커버리지</p>
                                    <p className="text-xl font-bold">
                                        {Math.round((result.coverage?.coverage ?? 0) * 100)}%
                                    </p>
                                    <Progress value={(result.coverage?.coverage ?? 0) * 100} className="mt-2 h-1.5" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {result.coverage?.present?.length ?? 0}/{result.coverage?.required ?? 0} 항목
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-6">
                                    <p className="text-xs text-muted-foreground mb-1">규제 검토</p>
                                    <p className={`text-xl font-bold ${result.upload_allowed ? "text-emerald-600" : "text-red-600"}`}>
                                        {result.compliance?.verdict}
                                    </p>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {Object.entries(counts).map(([sev, n]) => (
                                            <Badge key={sev} className={SEVERITY_STYLE[sev]?.badge}>
                                                {SEVERITY_STYLE[sev]?.label} {n as number}
                                            </Badge>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardContent className="pt-6">
                                    <p className="text-xs text-muted-foreground mb-1">온톨로지</p>
                                    <p className="text-xl font-bold">{result.graph_stats?.nodes ?? 0} 노드</p>
                                    <p className="text-xs text-muted-foreground mt-2">
                                        {result.graph_stats?.edges ?? 0} 엣지 · 수치 {result.graph_stats?.quantities ?? 0}건
                                    </p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 적재 게이트 */}
                        <Card className={result.upload_allowed ? "border-emerald-300" : "border-red-300"}>
                            <CardContent className="pt-6 flex items-start gap-3">
                                {result.upload_allowed ? (
                                    <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                                ) : (
                                    <ShieldAlert className="w-6 h-6 text-red-600 shrink-0" />
                                )}
                                <div className="flex-1">
                                    <p className="font-semibold">
                                        {result.upload_allowed
                                            ? `비식별 처리 후 ${result.collection_name} 컬렉션에 적재 가능`
                                            : "적재 차단 — 해소되지 않은 위반이 있습니다"}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        원문 그대로 적재: <strong>{result.upload_allowed_raw ? "가능" : "불가"}</strong>
                                        {" · "}
                                        개인정보 {result.compliance?.pii_detected ?? 0}건 탐지, {result.masking?.masked_count ?? 0}건 치환,
                                        잔존 {result.masking?.residual_count ?? 0}건
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 상세 탭 */}
                        <Tabs defaultValue="channels">
                            <TabsList>
                                <TabsTrigger value="channels">채널 분해</TabsTrigger>
                                <TabsTrigger value="compliance">규제 준수 평가</TabsTrigger>
                                <TabsTrigger value="coverage">필수지표</TabsTrigger>
                                <TabsTrigger value="ontology">온톨로지</TabsTrigger>
                            </TabsList>

                            {/* --- 채널 --- */}
                            <TabsContent value="channels" className="mt-4">
                                <div className="grid gap-4 md:grid-cols-4">
                                    {CHANNEL_META.map((c) => {
                                        const Icon = c.icon;
                                        const n =
                                            c.key === "excel"
                                                ? result.parse_summary?.tables ?? 0
                                                : (result.channels as any)?.[c.key] ?? 0;
                                        return (
                                            <Card key={c.key}>
                                                <CardContent className="pt-6">
                                                    <Icon className="w-5 h-5 text-primary mb-2" />
                                                    <p className="text-2xl font-bold">{n}</p>
                                                    <p className="text-sm font-medium">{c.label}</p>
                                                    <p className="text-xs text-muted-foreground">{c.desc}</p>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                                <Card className="mt-4">
                                    <CardContent className="pt-6 text-sm space-y-1">
                                        <p>전체 {result.parse_summary?.pages}면 · 텍스트 {result.parse_summary?.text_chars?.toLocaleString()}자</p>
                                        <p>표 {result.parse_summary?.tables}개 ({result.parse_summary?.table_rows}행, 숫자셀 {result.parse_summary?.numeric_cells}개)</p>
                                        <p>그림 {result.parse_summary?.images}개 — {JSON.stringify(result.parse_summary?.image_kinds)}</p>
                                        {(result.parse_summary?.warnings ?? []).map((w: string, i: number) => (
                                            <p key={i} className="text-amber-700">⚠ {w}</p>
                                        ))}
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {/* --- 규제 --- */}
                            <TabsContent value="compliance" className="mt-4 space-y-3">
                                {findings.map((f, i) => {
                                    const st = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info;
                                    const Icon = st.icon;
                                    return (
                                        <Card key={i}>
                                            <CardContent className="pt-6">
                                                <div className="flex items-start gap-3">
                                                    <Icon className="w-5 h-5 shrink-0 mt-0.5 text-muted-foreground" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                                            <Badge className={st.badge}>{st.label}</Badge>
                                                            <span className="text-xs text-muted-foreground">
                                                                {f.law} {f.article}
                                                            </span>
                                                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{f.rule}</code>
                                                        </div>
                                                        <p className="font-semibold">{f.title}</p>
                                                        <p className="text-sm text-muted-foreground mt-1">{f.detail}</p>
                                                        {f.samples?.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1">
                                                                {f.samples.map((s, j) => (
                                                                    <code key={j} className="text-xs bg-red-50 text-red-800 px-1.5 py-0.5 rounded">
                                                                        {s}
                                                                    </code>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {f.remedy && (
                                                            <p className="text-sm mt-2 border-l-2 border-primary/40 pl-3">
                                                                <strong>조치</strong> — {f.remedy}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                                <p className="text-xs text-muted-foreground">{result.compliance?.note}</p>
                            </TabsContent>

                            {/* --- 필수지표 --- */}
                            <TabsContent value="coverage" className="mt-4">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base">
                                            {result.coverage?.sector_name} 필수지표
                                        </CardTitle>
                                        <CardDescription>
                                            원단위 기준: {result.coverage?.unit_basis}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        {result.coverage?.present?.map((m) => (
                                            <div key={m.code} className="flex items-center gap-2 text-sm">
                                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                                <span className="flex-1">{m.label}</span>
                                                <code className="text-xs text-muted-foreground">{m.evidence}</code>
                                            </div>
                                        ))}
                                        {result.coverage?.missing?.map((m) => (
                                            <div key={m.code} className="flex items-center gap-2 text-sm">
                                                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                                <span className="flex-1">{m.label}</span>
                                                <Badge variant="destructive">누락</Badge>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {/* --- 온톨로지 --- */}
                            <TabsContent value="ontology" className="mt-4">
                                <Card>
                                    <CardHeader className="flex-row items-center justify-between space-y-0">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Network className="w-4 h-4" /> 온톨로지 그래프
                                            </CardTitle>
                                            <CardDescription>
                                                LLMWiki `--graph` 와 같은 형식 — Neo4j·Fuseki 적재, RDF 변환의 출발점
                                            </CardDescription>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={downloadGraph}>
                                            <Download className="w-4 h-4 mr-1.5" /> JSON 내려받기
                                        </Button>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div>
                                                <p className="text-sm font-medium mb-2">노드 종류</p>
                                                {Object.entries(result.graph_stats?.by_type ?? {}).map(([t, n]) => (
                                                    <div key={t} className="flex justify-between text-sm py-0.5">
                                                        <span className="text-muted-foreground">{t}</span>
                                                        <span className="font-medium">{n as number}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium mb-2">근거 등급 (derivation)</p>
                                                {Object.entries(result.graph_stats?.by_derivation ?? {}).map(([t, n]) => (
                                                    <div key={t} className="flex justify-between text-sm py-0.5">
                                                        <span className="text-muted-foreground">{t}</span>
                                                        <span className="font-medium">{n as number}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>

                        <p className="text-xs text-muted-foreground border-t pt-4">
                            🤖 이 분석 결과는 생성형 인공지능이 포함된 시스템으로 작성되었습니다.
                            구조·수치 추출과 규제 검토는 결정론적 규칙이 수행했으며, 최종 판단과 책임은 담당자에게 있습니다.
                            <span className="opacity-70"> (인공지능 기본법 제31조제2항 생성물 표시)</span>
                        </p>
                    </>
                )}
            </main>
        </div>
    );
};

export default KnowledgeBase;
