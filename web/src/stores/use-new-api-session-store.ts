import { create } from "zustand";

export type NewApiUser = {
    id: number;
    username: string;
    display_name?: string;
    group?: string;
};

type NewApiSessionState = {
    accessToken: string;
    sid: string;
    user: NewApiUser | null;
    setSession: (session: { accessToken: string; sid: string; user: NewApiUser | null }) => void;
    clearSession: () => void;
};

export const useNewApiSessionStore = create<NewApiSessionState>((set) => ({
    accessToken: "",
    sid: "",
    user: null,
    setSession: (session) => set(session),
    clearSession: () => set({ accessToken: "", sid: "", user: null }),
}));
