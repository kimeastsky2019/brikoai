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

export const api = {
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
        if (collectionId) body.collection_id = collectionId;
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
