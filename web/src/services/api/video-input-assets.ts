import axios from "axios";

import i18n from "@/i18n";
import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";

export type VideoInputAssetKind = "image" | "audio" | "video";

type Envelope<T> = { success?: boolean; message?: string; data?: T | null };
type PresignData = { asset_id: string; upload_url: string; upload_headers?: Record<string, string> };
type CompleteData = { url?: string };

const apiText = (key: string) => i18n.t(`apiErrors.${key}`);

export async function uploadVideoInputAsset(config: AiConfig, blob: Blob, kind: VideoInputAssetKind, options?: { signal?: AbortSignal; name?: string }) {
    const contentType = resolveVideoInputContentType(blob, kind, options?.name);
    let assetId = "";
    try {
        const presign = unwrapAsset((await axios.post<Envelope<PresignData>>(assetUrl(config, "/presign"), { kind, content_type: contentType, size: blob.size }, { headers: assetHeaders(config, "application/json"), signal: options?.signal })).data);
        assetId = presign.asset_id;
        const uploadHeaders = Object.fromEntries(Object.entries({ ...(presign.upload_headers || {}), "Content-Type": contentType }).filter(([name]) => !/^(host|content-length)$/i.test(name)));
        await axios.put(presign.upload_url, blob, { headers: uploadHeaders, signal: options?.signal });
        const complete = unwrapAsset((await axios.post<Envelope<CompleteData>>(assetUrl(config, `/${encodeURIComponent(assetId)}/complete`), {}, { headers: assetHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!complete.url || !/^https:\/\//i.test(complete.url)) throw new Error(apiText("videoInputUploadFailed"));
        return complete.url;
    } catch (error) {
        if (assetId) void axios.delete(assetUrl(config, `/${encodeURIComponent(assetId)}`), { headers: assetHeaders(config) }).catch(() => undefined);
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        if (error instanceof Error && error.message === apiText("unsupportedVideoInputType")) throw error;
        throw new Error(readAssetError(error));
    }
}

export function resolveVideoInputContentType(blob: Blob, kind: VideoInputAssetKind, name = "") {
    const raw = (blob.type || "").toLowerCase().trim();
    const file = name.toLowerCase();
    if (kind === "image") {
        if (raw === "image/jpg" || raw === "image/jpeg" || file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
        if (raw === "image/png" || file.endsWith(".png")) return "image/png";
        if (raw === "image/webp" || file.endsWith(".webp")) return "image/webp";
        if (raw === "image/gif" || file.endsWith(".gif")) return "image/gif";
        if (raw.startsWith("image/")) return raw;
        return "image/png";
    }
    if (kind === "audio") {
        if (raw === "audio/mpeg" || raw === "audio/mp3" || file.endsWith(".mp3")) return "audio/mpeg";
        if (raw === "audio/wav" || raw === "audio/x-wav" || raw === "audio/wave" || file.endsWith(".wav")) return "audio/wav";
        if (raw.startsWith("audio/")) return raw;
        if (!raw) return "audio/mpeg";
        throw new Error(apiText("unsupportedVideoInputType"));
    }
    if (raw === "video/quicktime" || file.endsWith(".mov")) return "video/quicktime";
    if (raw === "video/mp4" || file.endsWith(".mp4") || !raw) return "video/mp4";
    throw new Error(apiText("unsupportedVideoInputType"));
}

function unwrapAsset<T>(payload: Envelope<T>): T {
    if (!payload?.success || payload.data == null) throw new Error(payload?.message || apiText("videoInputUploadFailed"));
    return payload.data;
}

function assetUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, `/video/input-assets${path}`);
}

function assetHeaders(config: AiConfig, contentType?: string) {
    return { Authorization: `Bearer ${config.apiKey}`, ...(contentType ? { "Content-Type": contentType } : {}) };
}

function readAssetError(error: unknown) {
    if (axios.isAxiosError<{ message?: string; error?: { message?: string } }>(error)) {
        return error.response?.data?.message || error.response?.data?.error?.message || apiText("videoInputUploadFailed");
    }
    return error instanceof Error ? error.message : apiText("videoInputUploadFailed");
}
