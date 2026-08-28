import { isNewApiAuthEnabled } from "@/integrations/new-api/enabled";
import { hasCachedNewApiChannels, rememberSyncedUser, syncNewApiTokensToChannels, waitForConfigHydration } from "@/integrations/new-api/sync-channels";
import { redirectToNewApiSignIn, refreshNewApiSession } from "@/services/api/new-api";
import { useNewApiSessionStore } from "@/stores/use-new-api-session-store";

export type NewApiBootstrapResult = { status: "skipped" } | { status: "redirected" } | { status: "cached" } | { status: "ready"; tokenCount: number; channelCount: number } | { status: "sync-failed" };

let bootstrapPromise: Promise<NewApiBootstrapResult> | null = null;

export function bootstrapNewApi() {
    if (!bootstrapPromise) bootstrapPromise = runBootstrap();
    return bootstrapPromise;
}

async function runBootstrap(): Promise<NewApiBootstrapResult> {
    if (!isNewApiAuthEnabled()) return { status: "skipped" };
    let session: Awaited<ReturnType<typeof refreshNewApiSession>> = null;
    try {
        session = await refreshNewApiSession();
    } catch {
        session = null;
    }
    if (!session) {
        redirectToNewApiSignIn();
        return { status: "redirected" };
    }
    await waitForConfigHydration();
    if (hasCachedNewApiChannels()) {
        rememberSyncedUser();
        return { status: "cached" };
    }
    try {
        const synced = await syncNewApiTokensToChannels(session.accessToken);
        return { status: "ready", tokenCount: synced.tokenCount, channelCount: synced.channelCount };
    } catch (error) {
        console.error("[new-api] token sync failed", error);
        return { status: "sync-failed" };
    }
}

export async function syncNewApiTokensNow() {
    let accessToken = useNewApiSessionStore.getState().accessToken;
    if (!accessToken) {
        const session = await refreshNewApiSession();
        accessToken = session?.accessToken || "";
    }
    if (!accessToken) {
        redirectToNewApiSignIn();
        throw new Error("signed out");
    }
    return syncNewApiTokensToChannels(accessToken);
}
