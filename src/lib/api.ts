const resolveApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    if (envUrl) return envUrl;
    if (import.meta.env.DEV) return "http://localhost:8000";

    const parts = window.location.pathname.split("/").filter(Boolean);
    const base = parts.length > 0 ? `/${parts[0]}` : "";
    return `${window.location.origin}${base}/api`;
};

export const API_BASE_URL = resolveApiBaseUrl();

export interface Collection {
    id: number;
    name: string;
    xai_id: string;
    created_at: string;
    documents_count?: number;
    processing_count?: number;
    failed_count?: number;
    status?: string;
}

export interface ChatResponse {
    request_id: string;
    answer: string;
    citations: any[];
    cached: boolean;
    latency_ms: number;
}


// ---- 지식 데이터베이스 구축 -------------------------------------------------
export interface KbSector {
    code: string;
    name: string;
    ksic: string;
    energy_sources: string[];
    key_equipment: string[];
    required_metrics: { code: string; label: string }[];
    unit_basis: string;
    notes: string;
}

export interface KbFinding {
    rule: string;
    law: string;
    article: string;
    severity: "blocker" | "error" | "warning" | "info";
    title: string;
    detail: string;
    locations: string[];
    samples: string[];
    remedy: string;
    resolution: string | null;
}

export interface KbMetric {
    code: string;
    label: string;
    evidence: string | null;
}

export interface StatDocument {
    id: number;
    name: string;
    collection_id: number | null;
    collection_name: string | null;
    status: string;
    chunk_count: number;
    size_bytes: number | null;
    acl: string;
    doc_status: string;
    owner: string | null;
    created_at: string;
}

export interface StatQuery {
    id: number;
    endpoint: string;
    model: string;
    collection_id: number | null;
    collection_name: string | null;
    latency_ms: number | null;
    total_tokens: number | null;
    cached: boolean;
    created_at: string;
}

export interface StatCollection {
    id: number;
    name: string;
    qdrant_name: string;
    description: string | null;
    documents: number;
    chunks: number;
    processed: number;
    created_at: string;
}

/** 채널 카드(글/표/그림/엑셀)를 눌렀을 때 보여줄 원문 조각 */
export interface ChannelItem {
    page: number | null;
    anchor: string | null;
    numeric: number | null;
    chars: number;
    preview: string;
    truncated: boolean;
}

export interface WikiStatus {
    enabled: boolean;
    reason?: string;
    public_url?: string;
    contract?: string;
    pages?: number;
}

export interface WikiSaveResult {
    stored: boolean;
    skipped?: string;
    pages: any[];
    records?: any;
    channels?: any;
    lint?: any;
    warnings: string[];
    checks_failed: any[];
    /** 게이트가 막았을 때 무엇을 고쳐야 하는지 */
    gate?: {
        allowed?: boolean;
        allowed_raw?: boolean;
        masked_count?: number;
        residual_count?: number;
        residual?: { label?: string; value?: string }[];
        findings?: { severity?: string; rule?: string; detail?: string }[];
    };
    public_url: string;
}

/** 현장 체크리스트 — 항목은 위키의 개선안(measure) 카드에서 온다.
 *  화면이 목록을 직접 들고 있으면 진단이 쌓여도 점검표가 늘지 않는다. */
export interface ChecklistItem {
    id: string;
    name: string;
    source: string;      // 근거가 된 위키 페이지 stable_id
    checked: string;
    note: string;
}

export interface ChecklistGroup {
    equipment: string;
    fields: string[];    // 설비별로 현장에서 적을 값이 다르다
    items: ChecklistItem[];
}

export interface ChecklistDraft {
    sector: string;
    sector_name: string;
    unit_basis: string;
    energy_sources: string[];
    groups: ChecklistGroup[];
    item_count: number;
    /** 위키에서 끌어온 항목이 하나라도 있는가. false 면 설비 골격만 나간 것이다. */
    from_wiki: boolean;
    wiki_measures: number;
}

export interface ChecklistSummary {
    id: string;
    title: string;
    sector: string;
    subsector: string;
    site: string;
    owner: string;
    item_count: number;
    updated_at: string;
}

/** 저장본에는 sector_name·unit_basis 같은 파생 필드가 오지 않는다 — 서버가
 *  groups 와 식별 정보만 보관한다. 없을 수 있는 값으로 다뤄야 한다. */
export interface ChecklistRecord extends Partial<ChecklistDraft> {
    id: string;
    title: string;
    subsector: string;
    site: string;
    homepage: string;
    owner: string;
    note: string;
    groups: ChecklistGroup[];
    updated_at: string;
}

export interface KbAnalysis {
    filename: string;
    doc_hash: string;
    sector: string;
    sector_name: string;
    needs_review: boolean;
    collection_name: string;
    upload_allowed: boolean;
    upload_allowed_raw: boolean;
    channels: Record<string, number>;
    channel_items?: Record<string, ChannelItem[]>;
    parse_summary: any;
    classification: any;
    coverage: {
        sector: string;
        sector_name: string;
        unit_basis: string;
        required: number;
        coverage: number;
        present: KbMetric[];
        missing: KbMetric[];
    };
    compliance: {
        verdict: string;
        upload_allowed: boolean;
        counts: Record<string, number>;
        pii_detected: number;
        masking_enabled: boolean;
        findings: KbFinding[];
        note: string;
    };
    masking: { masked_count: number; residual_count: number; clean: boolean; residual: any[] };
    graph_stats: any;
    graph?: any;
    excel_path?: string | null;
    errors: string[];
}


function authHeaders(): Record<string, string> {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`${path} 조회 실패 (${res.status})`);
    return res.json();
}

export const api = {
    /** 지금 어떤 엔진이 답하는지 — 화면이 실제 구성을 그대로 보여주기 위한 것 */
    getHealth: () => getJson<any>("/health"),

    /** 대시보드 카드 드릴다운 */
    getStatDocuments: () => getJson<StatDocument[]>("/stats/documents"),
    getStatQueries: (limit = 100) => getJson<StatQuery[]>(`/stats/queries?limit=${limit}`),
    getStatCollections: () => getJson<StatCollection[]>("/stats/collections"),

    async getCollections(): Promise<Collection[]> {
        const token = localStorage.getItem("token");
        const headers: any = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/collections`, {
            headers: headers
        });
        if (!res.ok) throw new Error("Failed to fetch collections");
        return res.json();
    },

    async createCollection(name: string): Promise<Collection> {
        const token = localStorage.getItem("token");
        const headers: any = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/collections`, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ name }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to create collection");
        }
        return res.json();
    },

    async uploadDocument(collectionId: number, file: File): Promise<any> {
        const formData = new FormData();
        formData.append("file", file);

        const token = localStorage.getItem("token");
        const headers: any = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/collections/${collectionId}/upload`, {
            method: "POST",
            headers: headers,
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to upload document");
        }
        return res.json();
    },

    async chat(query: string, collectionId?: number, filters?: any): Promise<ChatResponse> {
        const body: any = { query };
        // 0 은 '전체 컬렉션' 을 뜻하는 유효한 값이다. truthy 검사로 두면
        // 0 이 통째로 빠져 서버가 422 를 낸다.
        if (collectionId !== undefined && collectionId !== null) body.collection_id = collectionId;
        if (filters) body.filters = filters;

        const token = localStorage.getItem("token");
        const headers: any = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/chat`, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to chat");
        }
        return res.json();
    },

    async login(username: string, password: string): Promise<any> {
        const formData = new URLSearchParams();
        formData.append("username", username);
        formData.append("password", password);

        const res = await fetch(`${API_BASE_URL}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Login failed");
        }
        const data = await res.json();
        localStorage.setItem("token", data.access_token);
        return data;
    },

    async getDocuments(collectionId: number, refresh?: boolean): Promise<any[]> {
        const token = localStorage.getItem("token");
        const headers: any = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const refreshParam = refresh ? "?refresh=true" : "";
        const res = await fetch(`${API_BASE_URL}/collections/${collectionId}${refreshParam}`, {
            headers: headers
        });

        if (!res.ok) throw new Error("Failed to fetch documents");
        return res.json();
    },

    async deleteDocument(documentId: number): Promise<any> {
        const token = localStorage.getItem("token");
        const headers: any = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
            method: "DELETE",
            headers: headers
        });

        if (!res.ok) throw new Error("Failed to delete document");
        return res.json();
    },

    async deleteCollection(collectionId: number): Promise<any> {
        const token = localStorage.getItem("token");
        const headers: any = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/collections/${collectionId}`, {
            method: "DELETE",
            headers: headers
        });

        if (!res.ok) throw new Error("Failed to delete collection");
        return res.json();
    },

    async getStats(): Promise<any> {
        const token = localStorage.getItem("token");
        const headers: any = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE_URL}/stats`, {
            headers: headers
        });

        if (!res.ok) {
            console.warn("Failed to fetch stats");
            return null;
        }
        return res.json();
    },

    async register(email: string, password: string, fullName?: string): Promise<any> {
        const res = await fetch(`${API_BASE_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, full_name: fullName }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Registration failed");
        }
        return res.json();
    },

    // ---- 지식 데이터베이스 구축 ---------------------------------------------
    async kbGetSectors(): Promise<{ sectors: KbSector[]; count: number }> {
        const res = await fetch(`${API_BASE_URL}/kb/sectors`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}: 업종 목록을 불러오지 못했습니다`);
        return res.json();
    },

    // ── 현장 체크리스트 (위키 /api/audit/* 를 rag-api 가 중계) ──
    checklistDraft: (sector: string) =>
        getJson<ChecklistDraft>(`/kb/audit/checklist/draft?sector=${encodeURIComponent(sector)}`),
    checklists: () => getJson<{ checklists: ChecklistSummary[] }>("/kb/audit/checklists"),
    checklist: (cid: string) =>
        getJson<ChecklistRecord>(`/kb/audit/checklists/${encodeURIComponent(cid)}`),

    async saveChecklist(payload: Record<string, unknown>): Promise<ChecklistRecord> {
        const res = await fetch(`${API_BASE_URL}/kb/audit/checklists`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            let msg = `저장 실패 (${res.status})`;
            try { msg = (await res.json()).detail || msg; } catch { /* JSON 이 아닐 수 있다 */ }
            throw new Error(msg);
        }
        return res.json();
    },

    async deleteChecklist(cid: string): Promise<void> {
        const res = await fetch(`${API_BASE_URL}/kb/audit/checklists/${encodeURIComponent(cid)}`, {
            method: "DELETE",
            headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
    },

    /** 위키 연동 가능 여부 — 버튼 노출 판단용 */
    kbWikiStatus: () => getJson<WikiStatus>("/kb/wiki/status"),

    /** 원본 PDF 를 LLM Wiki 표준 문서로 저장한다 (서버가 위키로 중계). */
    async kbWikiSave(file: File, site: string, sector?: string, owner?: string): Promise<WikiSaveResult> {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("site", site);
        if (sector) fd.append("sector", sector);
        if (owner) fd.append("owner", owner);
        const res = await fetch(`${API_BASE_URL}/kb/wiki/save`, {
            method: "POST",
            headers: authHeaders(),
            body: fd,
        });
        if (!res.ok) {
            let msg = `위키 저장 실패 (${res.status})`;
            try { msg = (await res.json()).detail || msg; } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
            throw new Error(msg);
        }
        return res.json();
    },

    async kbAnalyze(file: File, sector?: string): Promise<KbAnalysis> {
        if (!file) throw new Error("파일이 필요합니다");
        const form = new FormData();
        form.append("file", file);
        if (sector) form.append("sector", sector);
        const res = await fetch(`${API_BASE_URL}/kb/analyze`, {
            method: "POST",
            headers: authHeaders(),
            body: form,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "분석에 실패했습니다" }));
            throw new Error(err.detail || `HTTP ${res.status}: 분석에 실패했습니다`);
        }
        return res.json();
    },

    async kbReviewCompliance(text: string, sector = "other"): Promise<KbAnalysis["compliance"]> {
        const res = await fetch(`${API_BASE_URL}/kb/compliance/review`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ text, sector }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: 규제 검토에 실패했습니다`);
        return res.json();
    },

    async kbMask(text: string): Promise<{ masked_count: number; residual_count: number; clean: boolean; masked_text: string }> {
        const res = await fetch(`${API_BASE_URL}/kb/compliance/mask`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: 비식별 처리에 실패했습니다`);
        return res.json();
    },

    logout() {
        localStorage.removeItem("token");
        window.location.hash = "#/login";
    }
};
