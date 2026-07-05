import { create } from 'zustand';

interface UserState {
  user: { name: string; email: string } | null;
  setUser: (user: { name: string; email: string } | null) => void;
}

interface MeetingState {
  isMicOn: boolean;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
}

export const useStore = create<UserState & MeetingState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  isMicOn: true,
  isCameraOn: true,
  toggleMic: () => set((state) => ({ isMicOn: !state.isMicOn })),
  toggleCamera: () => set((state) => ({ isCameraOn: !state.isCameraOn })),
}));
