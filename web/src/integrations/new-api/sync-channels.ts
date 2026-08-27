import { fetchChannelModels } from "@/services/api/image";
import { fetchNewApiTokenKeys, listEnabledNewApiTokens } from "@/services/api/new-api";
import { isNewApiChannelId, newApiChannelId } from "@/integrations/new-api/enabled";
import {
    createModelChannel,
    encodeChannelModel,
    guessCapability,
    modelMatchesCapability,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    useConfigStore,
    type ChannelModel,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

function mergeChannelModels(existing: ChannelModel[], names: string[]) {
    const previous = new Map(existing.map((model) => [model.name, model]));
    const next: ChannelModel[] = [];
    const seen = new Set<string>();
    for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        next.push(previous.get(trimmed) || { name: trimmed, capability: guessCapability(trimmed) });
    }
    for (const model of existing) {
        if (!seen.has(model.name)) next.push(model);
    }
    return next;
}

function pickModel(channels: ModelChannel[], current: string, capability: ModelCapability) {
    const config = { ...useConfigStore.getState().config, channels };
    const normalized = normalizeModelOptionValue(current, channels);
    if (normalized && modelMatchesCapability(config, normalized, capability)) return normalized;
    for (const channel of channels) {
        const model = channel.models.find((item) => item.capability === capability);
        if (model) return encodeChannelModel(channel.id, model.name);
    }
    return normalized || "";
}

async function modelsForChannel(channel: ModelChannel) {
    try {
        return mergeChannelModels(channel.models, await fetchChannelModels(channel));
    } catch {
        return channel.models;
    }
}

export async function syncNewApiTokensToChannels(accessToken: string) {
    await waitForConfigHydration();
    const tokens = await listEnabledNewApiTokens(accessToken);
    const keys = tokens.length ? await fetchNewApiTokenKeys(accessToken, tokens.map((token) => token.id)) : {};
    const origin = window.location.origin;
    const existing = useConfigStore.getState().config.channels;
    const existingById = new Map(existing.map((channel) => [channel.id, channel]));
    const synced: ModelChannel[] = tokens.flatMap((token) => {
        const apiKey = keys[token.id];
        if (!apiKey) return [];
        const id = newApiChannelId(token.id);
        const previous = existingById.get(id);
        return [
            createModelChannel({
                id,
                name: token.name?.trim() || previous?.name || `Token ${token.id}`,
                baseUrl: origin,
                apiKey,
                apiFormat: "openai",
                models: previous?.models || [],
            }),
        ];
    });
    const withModels = await Promise.all(
        synced.map(async (channel) => ({ ...channel, models: await modelsForChannel(channel) })),
    );
    const nextChannels = [
        ...existing.filter((channel) => !isNewApiChannelId(channel.id) && !shouldDropUnusedDefault(channel, withModels.length > 0)),
        ...withModels,
    ];
    applyChannels(nextChannels, origin);
    return { tokenCount: tokens.length, channelCount: withModels.length };
}

function shouldDropUnusedDefault(channel: ModelChannel, hasSynced: boolean) {
    return hasSynced && channel.id === "default" && !channel.apiKey.trim();
}

function applyChannels(channels: ModelChannel[], baseUrl: string) {
    const models = modelOptionsFromChannels(channels);
    useConfigStore.setState((state) => ({
        config: {
            ...state.config,
            channelMode: "local",
            baseUrl,
            channels,
            models,
            imageModel: pickModel(channels, state.config.imageModel, "image"),
            videoModel: pickModel(channels, state.config.videoModel, "video"),
            textModel: pickModel(channels, state.config.textModel, "text"),
            audioModel: pickModel(channels, state.config.audioModel, "audio"),
        },
    }));
}

function waitForConfigHydration() {
    if (useConfigStore.persist.hasHydrated()) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsub = useConfigStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
        });
        if (useConfigStore.persist.hasHydrated()) {
            unsub();
            resolve();
        }
    });
}
