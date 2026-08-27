/** Production `/huabu/` builds enable new-api auth. Local `bun run dev` stays open unless VITE_NEWAPI_AUTH=true. */
export function isNewApiAuthEnabled() {
    if (import.meta.env.VITE_NEWAPI_AUTH === "true") return true;
    if (import.meta.env.VITE_NEWAPI_AUTH === "false") return false;
    return (import.meta.env.BASE_URL || "/") !== "/";
}

export function newApiChannelId(tokenId: number) {
    return `newapi-${tokenId}`;
}

export function isNewApiChannelId(channelId: string) {
    return channelId.startsWith("newapi-");
}
