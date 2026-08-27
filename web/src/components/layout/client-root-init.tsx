import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { bootstrapNewApi } from "@/integrations/new-api/bootstrap";
import { isNewApiAuthEnabled } from "@/integrations/new-api/enabled";
import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const [ready, setReady] = useState(() => !isNewApiAuthEnabled());
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        let cancelled = false;
        void bootstrapNewApi().then((result) => {
            if (cancelled || result.status === "redirected") return;
            if (result.status === "sync-failed") message.error(t("newApi.syncFailed"));
            if (result.status === "ready" && result.tokenCount === 0) message.warning(t("newApi.noTokens"));
            setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, [message, t]);

    useEffect(() => {
        if (!ready || handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: t("config.channels.defaultName"), baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success(t("config.importedDirectConfig"));
    }, [config.channels, message, openConfigDialog, ready, t, updateConfig]);

    if (!ready) {
        return <div className="flex min-h-screen items-center justify-center text-sm text-stone-500 dark:text-stone-400">{t("newApi.bootstrapping")}</div>;
    }

    return <>{children}</>;
}
