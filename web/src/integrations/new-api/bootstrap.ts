import { isNewApiAuthEnabled } from "@/integrations/new-api/enabled";
import { syncNewApiTokensToChannels } from "@/integrations/new-api/sync-channels";
import { redirectToNewApiSignIn, refreshNewApiSession } from "@/services/api/new-api";

export type NewApiBootstrapResult = { status: "skipped" } | { status: "redirected" } | { status: "ready"; tokenCount: number; channelCount: number } | { status: "sync-failed" };

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
    try {
        const synced = await syncNewApiTokensToChannels(session.accessToken);
        return { status: "ready", tokenCount: synced.tokenCount, channelCount: synced.channelCount };
    } catch (error) {
        console.error("[new-api] token sync failed", error);
        return { status: "sync-failed" };
    }
}
