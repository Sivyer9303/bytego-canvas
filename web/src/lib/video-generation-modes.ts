import i18n from "@/i18n";

export type VideoGenerationType = "text2video" | "image2video" | "multi_image" | "start_end" | "reference_audio" | "reference_videos";
export type VideoMediaRole = "reference" | "first_frame" | "last_frame";

export type VideoGenerationMode = {
    value: VideoGenerationType;
    imagesMin: number;
    imagesMax: number;
    videosMin: number;
    videosMax: number;
    allowVideo: boolean;
    requireVideo: boolean;
    allowAudio: boolean;
    requireAudio: boolean;
    imageRoles: VideoMediaRole[];
};

/** SilkRoad / video-tool generation recipes. Billing is the same; request media roles are not. */
export const VIDEO_GENERATION_MODES: VideoGenerationMode[] = [
    { value: "text2video", imagesMin: 0, imagesMax: 0, videosMin: 0, videosMax: 0, allowVideo: false, requireVideo: false, allowAudio: false, requireAudio: false, imageRoles: [] },
    { value: "image2video", imagesMin: 1, imagesMax: 1, videosMin: 0, videosMax: 0, allowVideo: false, requireVideo: false, allowAudio: false, requireAudio: false, imageRoles: ["reference"] },
    { value: "multi_image", imagesMin: 2, imagesMax: 9, videosMin: 0, videosMax: 0, allowVideo: false, requireVideo: false, allowAudio: false, requireAudio: false, imageRoles: ["reference"] },
    { value: "start_end", imagesMin: 2, imagesMax: 2, videosMin: 0, videosMax: 0, allowVideo: false, requireVideo: false, allowAudio: false, requireAudio: false, imageRoles: ["first_frame", "last_frame"] },
    { value: "reference_audio", imagesMin: 1, imagesMax: 9, videosMin: 0, videosMax: 0, allowVideo: false, requireVideo: false, allowAudio: true, requireAudio: true, imageRoles: ["reference"] },
    { value: "reference_videos", imagesMin: 0, imagesMax: 9, videosMin: 1, videosMax: 3, allowVideo: true, requireVideo: true, allowAudio: true, requireAudio: false, imageRoles: ["reference"] },
];

export const DEFAULT_VIDEO_GENERATION_TYPE: VideoGenerationType = "text2video";

export function resolveVideoGenerationMode(value: string | undefined): VideoGenerationMode {
    return VIDEO_GENERATION_MODES.find((mode) => mode.value === value) || VIDEO_GENERATION_MODES[0];
}

export function normalizeVideoGenerationType(value: string | undefined): VideoGenerationType {
    return resolveVideoGenerationMode(value).value;
}

export function videoImageRoleAt(mode: VideoGenerationMode, index: number): VideoMediaRole {
    return mode.imageRoles[index] ?? mode.imageRoles[0] ?? "reference";
}

export function assertVideoGenerationMedia(mode: VideoGenerationMode, imageCount: number, videoCount: number, audioCount: number) {
    if (imageCount < mode.imagesMin || imageCount > mode.imagesMax) {
        throw new Error(i18n.t("apiErrors.videoModeImageCount", { min: mode.imagesMin, max: mode.imagesMax }));
    }
    if (mode.allowVideo) {
        if (videoCount < mode.videosMin || videoCount > mode.videosMax) {
            throw new Error(i18n.t("apiErrors.videoModeVideoCount", { min: mode.videosMin, max: mode.videosMax }));
        }
    } else if (videoCount > 0) {
        throw new Error(i18n.t("apiErrors.videoModeVideoNotAllowed"));
    }
    if (mode.requireAudio && audioCount < 1) {
        throw new Error(i18n.t("apiErrors.videoModeAudioRequired"));
    }
    if (!mode.allowAudio && audioCount > 0) {
        throw new Error(i18n.t("apiErrors.videoModeAudioNotAllowed"));
    }
}
