import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { nanoid } from "nanoid";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Generate a unique id.
 *
 * Avoid `crypto.randomUUID`, which is only exposed in secure contexts (HTTPS or
 * localhost) — over plain HTTP it is undefined and throws. `nanoid` works in any
 * context.
 */
export function randomId(): string {
    return nanoid();
}

/** Resolve a public file against Vite `base` (e.g. `/huabu/logo.png`). */
export function publicAsset(path: string) {
    return `${import.meta.env.BASE_URL || "/"}${path.replace(/^\//, "")}`;
}

/** Prefix a same-origin public URL with Vite `base` when it is still root-absolute. */
export function withPublicBase(url: string) {
    if (!url.startsWith("/") || url.startsWith("//")) return url;
    const base = import.meta.env.BASE_URL || "/";
    if (base === "/" || url.startsWith(base)) return url;
    return `${base}${url.slice(1)}`;
}
