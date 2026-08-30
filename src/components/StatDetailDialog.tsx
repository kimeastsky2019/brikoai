import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api, StatDocument, StatQuery, StatCollection } from "@/lib/api";

export type StatKind = "documents" | "queries" | "collections" | "latency";

const TITLES: Record<StatKind, { title: string; desc: string }> = {
    documents:   { title: "처리된 문서",  desc: "전 컬렉션에 인제스트된 문서 목록" },
    queries:     { title: "검색 쿼리",    desc: "최근 호출 기록 (최신순)" },
    collections: { title: "활성 컬렉션",  desc: "컬렉션별 문서·청크 수" },
    latency:     { title: "응답 시간",    desc: "최근 호출의 소요 시간 (최신순)" },
};

const fmtBytes = (n: number | null) =>
    n == null ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

const fmtTime = (s: string) => {
    const d = new Date(s.endsWith("Z") || s.includes("+") ? s : s + "Z");
    return isNaN(d.getTime()) ? s : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "medium" });
};

/** 대시보드 카드의 숫자를 눌렀을 때 그 숫자의 근거를 보여준다. */
const StatDetailDialog = ({ kind, onClose }: { kind: StatKind | null; onClose: () => void }) => {
    const [rows, setRows] = useState<any[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!kind) { setRows(null); setError(null); return; }
        setRows(null); setError(null);
        const load =
            kind === "documents"   ? api.getStatDocuments() :
            kind === "collections" ? api.getStatCollections() :
                                     api.getStatQueries(100);
        load.then(setRows).catch((e) => setError(e.message));
    }, [kind]);

    if (!kind) return null;
    const meta = TITLES[kind];

    return (
        <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{meta.title}</DialogTitle>
                    <DialogDescription>{meta.desc}</DialogDescription>
                </DialogHeader>

                {error && <p className="text-sm text-destructive">불러오지 못했습니다: {error}</p>}
                {!rows && !error && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

                {rows && rows.length === 0 && (
                    <p className="text-sm text-muted-foreground">아직 기록이 없습니다.</p>
                )}

                {rows && rows.length > 0 && (
                    <div className="max-h-[60vh] overflow-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-muted/95 backdrop-blur text-xs">
                                {kind === "documents" && (
                                    <tr className="text-left">
                                        <th className="p-2">문서</th><th className="p-2">컬렉션</th>
                                        <th className="p-2">상태</th><th className="p-2 text-right">청크</th>
                                        <th className="p-2 text-right">크기</th><th className="p-2">등록</th>
                                    </tr>
                                )}
                                {kind === "collections" && (
                                    <tr className="text-left">
                                        <th className="p-2">컬렉션</th><th className="p-2 text-right">문서</th>
                                        <th className="p-2 text-right">청크</th><th className="p-2">Qdrant</th>
                                        <th className="p-2">생성</th>
                                    </tr>
                                )}
                                {(kind === "queries" || kind === "latency") && (
                                    <tr className="text-left">
                                        <th className="p-2">엔드포인트</th><th className="p-2">컬렉션</th>
                                        <th className="p-2 text-right">응답</th><th className="p-2 text-right">토큰</th>
                                        <th className="p-2">시각</th>
                                    </tr>
                                )}
                            </thead>
                            <tbody>
                                {rows.map((r: any) => (
                                    <tr key={r.id} className="border-t hover:bg-muted/40">
                                        {kind === "documents" && (<>
                                            <td className="p-2 max-w-[22rem] truncate" title={r.name}>{r.name}</td>
                                            <td className="p-2">{r.collection_name ?? "—"}</td>
                                            <td className="p-2">
                                                <Badge variant={r.status === "processed" ? "default" : "secondary"}>{r.status}</Badge>
                                            </td>
                                            <td className="p-2 text-right tabular-nums">{r.chunk_count || "—"}</td>
                                            <td className="p-2 text-right tabular-nums">{fmtBytes(r.size_bytes)}</td>
                                            <td className="p-2 text-xs text-muted-foreground">{fmtTime(r.created_at)}</td>
                                        </>)}
                                        {kind === "collections" && (<>
                                            <td className="p-2">{r.name}</td>
                                            <td className="p-2 text-right tabular-nums">{r.documents}</td>
                                            <td className="p-2 text-right tabular-nums">{r.chunks || "—"}</td>
                                            <td className="p-2 text-xs font-mono text-muted-foreground">{r.qdrant_name}</td>
                                            <td className="p-2 text-xs text-muted-foreground">{fmtTime(r.created_at)}</td>
                                        </>)}
                                        {(kind === "queries" || kind === "latency") && (<>
                                            <td className="p-2 font-mono text-xs">{r.endpoint}</td>
                                            <td className="p-2">{r.collection_name ?? "—"}</td>
                                            <td className="p-2 text-right tabular-nums">
                                                {r.latency_ms != null ? `${r.latency_ms.toLocaleString()}ms` : "—"}
                                                {r.cached && <Badge variant="secondary" className="ml-1">캐시</Badge>}
                                            </td>
                                            <td className="p-2 text-right tabular-nums">{r.total_tokens ?? "—"}</td>
                                            <td className="p-2 text-xs text-muted-foreground">{fmtTime(r.created_at)}</td>
                                        </>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default StatDetailDialog;
