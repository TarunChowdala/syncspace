import { useRef, useCallback, useState } from 'react';
import { getSocket } from '../services/socket';

export function useWebRTC(localStreamRef: React.MutableRefObject<MediaStream | null>) {
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream | null>>({});
  const remoteVideoElementsAttachedRef = useRef<Set<string>>(new Set());
  const [remoteVideoStates, setRemoteVideoStates] = useState<Record<string, boolean>>({});

  const createPeer = useCallback(async (peerId: string, isInitiator: boolean) => {
    const socket = getSocket();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peersRef.current.set(peerId, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
      console.log('createPeer:', peerId, 'added local tracks from stream');
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      console.log('createPeer:', peerId, 'added transceivers, no local stream yet');
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      console.log('pc.ontrack from', peerId, 'streamId=', stream.id, 'track kind=', event.track.kind, 'enabled=', event.track.enabled);

      if (event.track.kind === 'video') {
        setRemoteVideoStates((prev) => ({ ...prev, [peerId]: event.track.enabled }));

        event.track.onended = () => {
          console.log('Video track ended for', peerId);
          setRemoteVideoStates((prev) => ({ ...prev, [peerId]: false }));
        };
        event.track.addEventListener('mute', () => {
          console.log('Video track muted for', peerId);
          setRemoteVideoStates((prev) => ({ ...prev, [peerId]: false }));
        });
        event.track.addEventListener('unmute', () => {
          console.log('Video track unmuted for', peerId);
          setRemoteVideoStates((prev) => ({ ...prev, [peerId]: true }));
        });
      }

      remoteStreamsRef.current[peerId] = stream;

      if (!remoteVideoElementsAttachedRef.current.has(peerId)) {
        const videoEl = remoteVideoRefs.current[peerId];
        if (videoEl) {
          try {
            videoEl.srcObject = stream;
            videoEl.play().catch((err) => {
              console.warn('video.play() failed for', peerId, err);
            });
            remoteVideoElementsAttachedRef.current.add(peerId);
            console.log('video element attached for', peerId);
          } catch (e) {
            console.warn('Error attaching stream to video element for', peerId, e);
          }
        } else {
          console.log('video element not mounted yet for', peerId);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('pc.onconnectionstatechange', peerId, pc.connectionState, 'ice=', pc.iceConnectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.close();
        peersRef.current.delete(peerId);
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log('pc.oniceconnectionstatechange', peerId, pc.iceConnectionState);
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const hasMVideo = !!pc.localDescription?.sdp?.includes('\nm=video');
        const hasMaudio = !!pc.localDescription?.sdp?.includes('\nm=audio');
        console.log('Local offer created for', peerId, 'm=video=', hasMVideo, 'm=audio=', hasMaudio);
        socket.emit('offer', { to: peerId, offer });
      } catch (err) {
        console.error('Offer error', err);
      }
    }

    return pc;
  }, [localStreamRef]);

  const removePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      try { pc.close(); } catch (e) {}
      peersRef.current.delete(peerId);
    }
    if (remoteVideoRefs.current[peerId]) {
      try { remoteVideoRefs.current[peerId]!.srcObject = null; } catch (e) {}
      delete remoteVideoRefs.current[peerId];
    }
    remoteVideoElementsAttachedRef.current.delete(peerId);
    delete remoteStreamsRef.current[peerId];
    setRemoteVideoStates(prev => {
        const copy = {...prev};
        delete copy[peerId];
        return copy;
    });
  }, []);

  const replaceTracks = useCallback(() => {
    if (!localStreamRef.current) return;
    const stream = localStreamRef.current;
    
    peersRef.current.forEach((pc) => {
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      
      pc.getTransceivers().forEach(transceiver => {
        if (transceiver.receiver.track.kind === 'video' && videoTrack && transceiver.sender.track !== videoTrack) {
           transceiver.sender.replaceTrack(videoTrack).catch(e => console.error('Error replacing video track:', e));
        }
        if (transceiver.receiver.track.kind === 'audio' && audioTrack && transceiver.sender.track !== audioTrack) {
           transceiver.sender.replaceTrack(audioTrack).catch(e => console.error('Error replacing audio track:', e));
        }
      });
    });
  }, [localStreamRef]);

  const broadcastVideoState = useCallback((enabled: boolean) => {
    const socket = getSocket();
    peersRef.current.forEach((_, peerId) => {
      console.log('Broadcasting video-state', enabled, 'to', peerId);
      socket.emit('video-state', { to: peerId, enabled });
    });
  }, []);

  const handleRemoteVideoState = useCallback((from: string, enabled: boolean) => {
    console.log('Received video-state from', from, 'enabled=', enabled);
    setRemoteVideoStates((prev) => ({ ...prev, [from]: enabled }));
  }, []);

  return {
    peersRef,
    remoteVideoRefs,
    iceCandidateQueueRef,
    createPeer,
    removePeer,
    remoteVideoStates,
    replaceTracks,
    remoteStreamsRef,
    remoteVideoElementsAttachedRef,
    broadcastVideoState,
    handleRemoteVideoState,
  };
}
