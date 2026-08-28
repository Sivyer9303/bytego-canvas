import type { ModelCapability } from "@/stores/use-config-store";

import table from "./group-capabilities.json";

const CAPABILITIES: ModelCapability[] = ["image", "video", "text", "audio"];

function buildLookup() {
    const lookup = new Map<string, ModelCapability>();
    for (const capability of CAPABILITIES) {
        const groups = (table as Record<string, string[]>)[capability] || [];
        for (const group of groups) {
            const key = group.trim();
            if (!key) continue;
            lookup.set(key, capability);
            lookup.set(key.toLowerCase(), capability);
        }
    }
    return lookup;
}

const GROUP_CAPABILITY = buildLookup();

export function capabilityForGroup(group: string): ModelCapability {
    const key = group.trim();
    if (!key) return "text";
    return GROUP_CAPABILITY.get(key) || GROUP_CAPABILITY.get(key.toLowerCase()) || "text";
}
