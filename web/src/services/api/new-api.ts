import axios from "axios";

import { useNewApiSessionStore, type NewApiUser } from "@/stores/use-new-api-session-store";

const TOKEN_STATUS_ENABLED = 1;
const PAGE_SIZE = 100;

type ApiEnvelope<T> = {
    success?: boolean;
    message?: string;
    code?: string;
    data?: T;
};

export type NewApiToken = {
    id: number;
    name: string;
    status: number;
    group?: string;
};

type RefreshData = {
    access_token?: string;
    session?: { sid?: string };
    user?: NewApiUser;
};

function dashboardHeaders(accessToken?: string, sid?: string) {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (sid) headers["X-Auth-Session"] = sid;
    return headers;
}

export async function refreshNewApiSession() {
    const sid = useNewApiSessionStore.getState().sid;
    const response = await axios.post<ApiEnvelope<RefreshData>>("/api/user/auth/refresh", null, {
        withCredentials: true,
        headers: dashboardHeaders(undefined, sid || undefined),
        validateStatus: () => true,
    });
    const data = response.data?.data;
    if (response.status >= 400 || !response.data?.success || !data?.access_token) return null;
    const nextSid = data.session?.sid || sid;
    const user = data.user || null;
    useNewApiSessionStore.getState().setSession({ accessToken: data.access_token, sid: nextSid, user });
    return { accessToken: data.access_token, sid: nextSid, user };
}

export async function logoutNewApiSession() {
    const { accessToken, sid } = useNewApiSessionStore.getState();
    try {
        await axios.post("/api/user/auth/logout", null, {
            withCredentials: true,
            headers: dashboardHeaders(accessToken || undefined, sid || undefined),
            validateStatus: () => true,
        });
    } finally {
        useNewApiSessionStore.getState().clearSession();
    }
}

export function asInferenceKey(key: string) {
    const value = key.trim();
    if (!value) return "";
    return value.startsWith("sk-") ? value : `sk-${value}`;
}

export async function listEnabledNewApiTokens(accessToken: string) {
    const items: NewApiToken[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (items.length < total) {
        const response = await axios.get<ApiEnvelope<{ items?: NewApiToken[]; total?: number }>>("/api/token/", {
            params: { p: page, page_size: PAGE_SIZE },
            headers: dashboardHeaders(accessToken, useNewApiSessionStore.getState().sid || undefined),
        });
        if (!response.data?.success) throw new Error(response.data?.message || "token list failed");
        const pageItems = response.data.data?.items || [];
        total = response.data.data?.total ?? pageItems.length;
        items.push(...pageItems);
        if (!pageItems.length || pageItems.length < PAGE_SIZE) break;
        page += 1;
    }
    return items.filter((token) => token.status === TOKEN_STATUS_ENABLED);
}

export async function fetchNewApiTokenKeys(accessToken: string, ids: number[]) {
    const keys: Record<number, string> = {};
    for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
        const chunk = ids.slice(offset, offset + PAGE_SIZE);
        if (!chunk.length) continue;
        const response = await axios.post<ApiEnvelope<{ keys?: Record<string, string> }>>(
            "/api/token/batch/keys",
            { ids: chunk },
            { headers: dashboardHeaders(accessToken, useNewApiSessionStore.getState().sid || undefined) },
        );
        if (!response.data?.success) throw new Error(response.data?.message || "token keys failed");
        for (const [id, key] of Object.entries(response.data.data?.keys || {})) {
            keys[Number(id)] = asInferenceKey(key);
        }
    }
    return keys;
}

export function redirectToNewApiSignIn() {
    const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}` || "/huabu/";
    window.location.replace(`/sign-in?redirect=${encodeURIComponent(redirect)}`);
}
