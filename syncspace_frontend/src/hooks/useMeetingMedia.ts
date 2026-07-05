import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';

export function useMeetingMedia(onStreamReady?: (stream: MediaStream) => void) {
  const { isMicOn, isCameraOn } = useStore();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const initMedia = async () => {
      if (localStreamRef.current) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        
        stream.getVideoTracks().forEach(t => t.enabled = isCameraOn);
        stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

        console.log('Obtained local stream tracks:', stream.getTracks().map(t => `${t.kind}(${t.enabled})`));

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
        
        setMediaReady(true);
        if (onStreamReady) onStreamReady(stream);
      } catch (error) {
        console.error('Media error:', error);
      }
    };

    initMedia();

    return () => {
      mounted = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = isCameraOn;
      });
      console.log('Video track enabled set to', isCameraOn);
    }
  }, [isCameraOn]);

  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMicOn;
      });
      console.log('Audio track enabled set to', isMicOn);
    }
  }, [isMicOn]);

  return { localStreamRef, localVideoRef, mediaReady };
}
