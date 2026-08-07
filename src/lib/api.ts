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

    logout() {
        localStorage.removeItem("token");
        window.location.hash = "#/login";
    }
};
