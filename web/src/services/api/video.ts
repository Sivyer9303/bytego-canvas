import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { isNewApiAuthEnabled } from "@/integrations/new-api/enabled";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import { assertVideoGenerationMedia, resolveVideoGenerationMode, videoImageRoleAt } from "@/lib/video-generation-modes";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { uploadVideoInputAsset, type VideoInputAssetKind } from "./video-input-assets";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id?: string | number; task_id?: string; status?: string; fail_reason?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string | boolean; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string | boolean; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "plugin" | "newapi"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, options);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(apiText("videoTimeout", { provider: "" }));
        await delay(2500, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isNewApiAuthEnabled()) return createNewApiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "newapi") return pollNewApiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult, config?: AiConfig, options?: RequestOptions): Promise<UploadedFile> {
    return uploadMediaFile(await materializeVideoBlob(config, result, options), "video");
}

async function createNewApiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/video/generations"), await buildUnifiedVideoBody(config, model, prompt, references, options), { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const id = videoTaskId(created);
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "newapi", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollNewApiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/video/generations/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const status = String(video.status || "").toLowerCase();
        const failed = ["failed", "failure", "cancelled", "canceled", "expired"].includes(status);
        const completed = ["completed", "succeeded", "success"].includes(status);
        if (completed) {
            const url = videoResultUrl(video);
            if (url) {
                try {
                    return { status: "completed", result: { blob: await materializeVideoBlob(config, { url }, options) } };
                } catch (error) {
                    if (axios.isCancel(error) || options?.signal?.aborted) throw error;
                }
            }
            return { status: "completed", result: { blob: await materializeVideoBlob(config, { url: aiApiUrl(config, `/videos/${task.id}/content`) }, options) } };
        }
        if (failed) return { status: "failed", error: readApiErrorMessage(video.fail_reason) || readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function buildUnifiedVideoBody(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const mode = resolveVideoGenerationMode(config.videoGenerationType);
    const videosIn = options?.videos || [];
    const audiosIn = options?.audios || [];
    assertVideoGenerationMedia(mode, references.length, videosIn.length, audiosIn.length);
    const imageItems = mode.imagesMax > 0 ? references : [];
    const videoItems = mode.allowVideo ? videosIn : [];
    const audioItems = mode.allowAudio ? audiosIn.slice(0, 1) : [];
    const [images, videos, audios] = await Promise.all([
        Promise.all(imageItems.map((image) => resolveUnifiedMediaSource(config, "image", image, options))),
        Promise.all(videoItems.map((video) => resolveUnifiedMediaSource(config, "video", video, options))),
        Promise.all(audioItems.map((audio) => resolveUnifiedMediaSource(config, "audio", audio, options))),
    ]);
    const media = [
        ...images.map((source, index) => ({ type: "image", role: videoImageRoleAt(mode, index), source })),
        ...videos.map((source) => ({ type: "video", role: "reference" as const, source })),
        ...audios.map((source) => ({ type: "audio" as const, source })),
    ];
    return {
        model: modelOptionName(model),
        prompt,
        generation_type: mode.value,
        aspect_ratio: aspectRatioFromSize(config.size),
        seconds: Number(normalizeVideoSeconds(config.videoSeconds)),
        resolution: normalizeVideoResolution(config.vquality),
        ...(media.length ? { media } : {}),
    };
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        const id = videoTaskId(created);
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: { blob: await materializeVideoBlob(config, { url }, options) } };
        if (video.status === "completed") {
            return { status: "completed", result: { blob: await materializeVideoBlob(config, { url: aiApiUrl(config, `/videos/${task.id}/content`) }, options) } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (config.apiFormat === "gemini") throw new Error(apiText("geminiVideoUnsupported"));
}

function aspectRatioFromSize(value: string) {
    if (/^\d+:\d+$/.test(value)) return value;
    const size = normalizeVideoSize(value);
    if (!size) return "16:9";
    const [width, height] = size.split("x").map(Number);
    if (!width || !height) return "16:9";
    if (width === height) return "1:1";
    return width > height ? "16:9" : "9:16";
}

function videoTaskId(payload: VideoResponse) {
    if (typeof payload.task_id === "string" && payload.task_id) return payload.task_id;
    return typeof payload.id === "string" && payload.id ? payload.id : "";
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return String(Math.max(1, Math.min(30, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (!isOkCode(payload.code)) throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (payload.data == null) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function isOkCode(code: number | string | boolean) {
    return code === 0 || code === "0" || code === "success" || code === true;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || isSiteVideoContentUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

async function materializeVideoBlob(config: AiConfig | undefined, result: VideoGenerationResult, options?: RequestOptions, depth = 0): Promise<Blob> {
    if (depth > 3) throw new Error(apiText("videoDownloadFailed"));
    if (result.blob) {
        const nestedUrl = await nestedVideoUrlFromBlob(result.blob);
        if (nestedUrl) return materializeVideoBlob(config, { url: nestedUrl }, options, depth + 1);
        try {
            await assertVideoBlob(result.blob);
            return asVideoBlob(result.blob);
        } catch (error) {
            if (result.url) return materializeVideoBlob(config, { url: result.url }, options, depth + 1);
            throw error;
        }
    }
    if (!result.url) throw new Error(apiText("noPlayableVideo"));
    return materializeVideoBlob(config, { blob: await fetchVideoBytes(config, result.url, options) }, options, depth + 1);
}

async function fetchVideoBytes(config: AiConfig | undefined, url: string, options?: RequestOptions) {
    try {
        const useAuth = shouldAuthVideoUrl(config, url);
        const requestUrl = useAuth && config ? apiVideoRequestUrl(config, url) : url;
        const response = await axios.get<Blob>(requestUrl, { headers: useAuth && config ? aiHeaders(config) : undefined, responseType: "blob", signal: options?.signal });
        return response.data;
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        throw new Error(readAxiosError(error, apiText("videoDownloadFailed")));
    }
}

function shouldAuthVideoUrl(config: AiConfig | undefined, url: string) {
    if (!config) return false;
    if (isSiteVideoContentUrl(url) || url.startsWith("/")) return true;
    try {
        const base = new URL(config.baseUrl || "/", typeof window === "undefined" ? "http://localhost" : window.location.href);
        const target = new URL(url, base);
        return target.origin === base.origin && /\/videos\/[^/]+\/content/.test(target.pathname);
    } catch {
        return false;
    }
}

function apiVideoRequestUrl(config: AiConfig, url: string) {
    const path = url.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/v1/, "");
    return aiApiUrl(config, path.startsWith("/") ? path : `/${path}`);
}

async function nestedVideoUrlFromBlob(blob: Blob) {
    if (blob.size > 64_000) return;
    const type = blob.type.toLowerCase();
    if (type.startsWith("video/")) return;
    const text = await blob.text();
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
    try {
        return nestedVideoUrlFromUnknown(JSON.parse(text));
    } catch {
        return;
    }
}

function nestedVideoUrlFromUnknown(value: unknown): string | undefined {
    if (typeof value === "string" && (isPublicMediaUrl(value) || isSiteVideoContentUrl(value) || /\.mp4(\?|#|$)/i.test(value))) return value;
    if (!value || typeof value !== "object") return;
    const record = value as VideoResponse & { data?: unknown };
    return videoResultUrl(record) || nestedVideoUrlFromUnknown(record.data);
}

function asVideoBlob(blob: Blob) {
    return blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });
}

async function resolveUnifiedMediaSource(config: AiConfig, kind: VideoInputAssetKind, item: { url?: string; dataUrl?: string; storageKey?: string; name?: string }, options?: RequestOptions) {
    const existing = item.dataUrl || item.url || "";
    if (/^https:\/\//i.test(existing)) return existing;
    const blob = await loadReferenceBlob(kind, item, options?.signal);
    if (!blob) throw new Error(apiText("videoInputUploadFailed"));
    return uploadVideoInputAsset(config, blob, kind, { signal: options?.signal, name: item.name });
}

async function loadReferenceBlob(kind: VideoInputAssetKind, item: { url?: string; dataUrl?: string; storageKey?: string }, signal?: AbortSignal) {
    if (item.storageKey) {
        const stored = kind === "image" ? await getImageBlob(item.storageKey) : await getMediaBlob(item.storageKey);
        if (stored) return stored;
    }
    const source = item.dataUrl || item.url || "";
    if (!source) return null;
    try {
        return await (await fetch(source, { signal })).blob();
    } catch {
        return null;
    }
}

function isSiteVideoContentUrl(value: string) {
    return /\/v1\/videos\/[^/?#]+\/content\/?$/.test(value);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    const type = blob.type.toLowerCase();
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (head[0] === 0x7b || head[0] === 0x5b || head[0] === 0x3c || type.includes("json") || type.includes("text") || type.includes("html")) {
        throw new Error((await jsonVideoError(blob)) || apiText("videoDownloadFailed"));
    }
    const isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
    const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    if (isMp4 || isWebm || (type.startsWith("video/") && blob.size > 1024)) return;
    if (blob.size < 1024) throw new Error(apiText("videoDownloadFailed"));
    if (!type || type.includes("octet-stream")) return;
    throw new Error(apiText("videoDownloadFailed"));
}

async function jsonVideoError(blob: Blob) {
    try {
        return readApiErrorMessage(JSON.parse(await blob.text()));
    } catch {
        return "";
    }
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
