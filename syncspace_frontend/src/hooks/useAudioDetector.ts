import { useEffect, useRef, useState } from 'react';

export function useAudioDetector(localStreamRef: React.MutableRefObject<MediaStream | null>, isMicOn: boolean) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isMicOn || !localStreamRef.current) {
      setIsSpeaking(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) {
      console.log('No audio tracks available');
      setIsSpeaking(false);
      return;
    }

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(localStreamRef.current);
      source.connect(analyser);
      analyser.fftSize = 256;
      audioContextRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setIsSpeaking(average > 10);
        console.log("average", average);
        animationFrameRef.current = requestAnimationFrame(checkAudio);
      };
      checkAudio();

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        try { source.disconnect(); } catch (e) {}
        try { audioContext.close(); } catch (e) {}
      };
    } catch (error) {
      console.error('Error setting up audio analysis:', error);
      setIsSpeaking(false);
      return () => {};
    }
  }, [isMicOn, localStreamRef.current]);

  return { isSpeaking };
}
