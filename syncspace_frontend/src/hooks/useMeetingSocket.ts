import { useEffect, useRef, useState, useCallback } from 'react';
import { joinRoom, leaveRoom, getSocket } from '../services/socket';

export function useMeetingSocket(
  roomId: string | undefined, 
  user: any,
  localStreamRef: React.MutableRefObject<MediaStream | null>,
  createPeer: (peerId: string, isInitiator: boolean) => Promise<RTCPeerConnection>,
  removePeer: (peerId: string) => void,
  peersRef: React.MutableRefObject<Map<string, RTCPeerConnection>>,
  iceCandidateQueueRef: React.MutableRefObject<Record<string, RTCIceCandidateInit[]>>,
  handleRemoteVideoState: (from: string, enabled: boolean) => void
) {
  const [participants, setParticipants] = useState<any[]>([]);
  const pendingInitiatorQueueRef = useRef<string[]>([]);

  const dedupeParticipants = (participants: any[]) => {
    return participants.reduce((acc: any[], participant) => {
      if (!acc.some((p) => p.socketId === participant.socketId)) {
        acc.push(participant);
      }
      return acc;
    }, []);
  };

  useEffect(() => {
    if (!roomId) return;

    const userName = user?.name || localStorage.getItem('userName') || 'Guest';
    console.log('Joining room', roomId, 'as', userName);
    const socket = joinRoom(roomId, userName);

    socket.on('connect', () => {
      console.log('Connected to server', socket.id);
    });
    
    socket.on('connect_error', (err: any) => {
      console.error('Socket connect_error', err);
    });

    socket.on('existing-participants', (data: any[]) => {
      console.log('Existing participants count=', data?.length);
      const filtered = dedupeParticipants(
        data.filter((p: any) => p.socketId !== socket.id)
      );
      setParticipants(filtered);

      filtered.forEach((p: any) => {
        if (p.socketId === socket.id) return;
        if (peersRef.current.has(p.socketId)) return;
        if (localStreamRef.current) {
          createPeer(p.socketId, true);
        } else {
          pendingInitiatorQueueRef.current.push(p.socketId);
          console.log('Queued initiator peer for', p.socketId);
        }
      });
    });

    socket.on('user-joined', (data: any) => {
      if (data.socketId === socket.id) return;
      console.log('user-joined', data.socketId);
      setParticipants((prev) => dedupeParticipants([...prev, data]));
    });

    socket.on('user-left', (data: any) => {
      console.log('user-left', data.socketId);
      setParticipants((prev) => prev.filter((p) => p.socketId !== data.socketId));
      removePeer(data.socketId);
    });

    socket.on('disconnect', () => {
      console.log('socket disconnected');
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('existing-participants');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('disconnect');
      leaveRoom();
    };
  }, [roomId, user, createPeer, removePeer, localStreamRef, peersRef]);

  // Signaling handlers
  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();

    const drainIceCandidates = async (peerId: string, pc: RTCPeerConnection) => {
      const queued = iceCandidateQueueRef.current[peerId] || [];
      if (!queued.length) return;

      console.log('Draining', queued.length, 'queued ICE candidates for', peerId);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Failed to add queued ICE candidate', err);
        }
      }
      iceCandidateQueueRef.current[peerId] = [];
    };

    const onOffer = async ({ from, offer }: any) => {
      console.log('Received offer from', from);
      let peer = peersRef.current.get(from);
      if (!peer) peer = await createPeer(from, false);
      if (peer.signalingState !== 'stable') {
        console.warn('Ignoring offer because peer is not stable:', peer.signalingState);
        return;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      await drainIceCandidates(from, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      console.log('Sending answer to', from);
      socket.emit('answer', { to: from, answer });
    };

    const onAnswer = async ({ from, answer }: any) => {
      const peer = peersRef.current.get(from);
      if (!peer) return;
      if (peer.signalingState !== 'have-local-offer' && peer.signalingState !== 'have-remote-pranswer') {
        console.warn('Ignoring answer because peer is in wrong state:', peer.signalingState);
        return;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
      const hasVideo = !!peer.remoteDescription?.sdp?.includes('\nm=video');
      console.log('Received answer from', from, 'm=video=', hasVideo);
      await drainIceCandidates(from, peer);
    };

    const onIce = async ({ from, candidate }: any) => {
      console.log('Received ICE candidate from', from);
      const peer = peersRef.current.get(from);
      if (!peer || !candidate) return;
      const candidateObj = new RTCIceCandidate(candidate);
      if (peer.remoteDescription && peer.remoteDescription.type) {
        try {
          await peer.addIceCandidate(candidateObj);
          console.log('Added ICE candidate to peer', from);
        } catch (err) {
          console.warn('Failed to add ICE candidate directly', err, candidate);
        }
      } else {
        console.log('Queueing ICE candidate for', from);
        iceCandidateQueueRef.current[from] = iceCandidateQueueRef.current[from] || [];
        iceCandidateQueueRef.current[from].push(candidate);
      }
    };

    const onVideoState = ({ from, enabled }: { from: string; enabled: boolean }) => {
      handleRemoteVideoState(from, enabled);
    };

    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIce);
    socket.on('video-state', onVideoState);

    return () => {
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIce);
      socket.off('video-state', onVideoState);
    };
  }, [roomId, createPeer, peersRef, iceCandidateQueueRef, handleRemoteVideoState]);

  const drainPendingInitiators = useCallback(() => {
    const queued = pendingInitiatorQueueRef.current.splice(0, pendingInitiatorQueueRef.current.length);
    if (queued.length) {
      console.log('Draining', queued.length, 'queued initiator peers after media ready', queued);
      queued.forEach((peerId) => {
        if (!peersRef.current.has(peerId)) {
          createPeer(peerId, true);
          console.log('Draining queued initiator peer', peerId);
        }
      });
    }
  }, [createPeer, peersRef]);

  return {
    participants,
    drainPendingInitiators
  };
}
