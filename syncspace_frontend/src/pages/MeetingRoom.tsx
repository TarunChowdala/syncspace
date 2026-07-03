import { Box, Flex, HStack, IconButton, Grid, GridItem, Text, Avatar } from '@chakra-ui/react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, MessageSquare, MonitorUp, Settings, Hand } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { getSocket, joinRoom, leaveRoom } from '../services/socket';

export default function MeetingRoom() {
  const { isMicOn, isCameraOn, toggleMic, toggleCamera, user } = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [participants, setParticipants] = useState<any[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream | null>>({});

  const dedupeParticipants = (participants: any[]) => {
    return participants.reduce((acc: any[], participant) => {
      if (!acc.some((p) => p.socketId === participant.socketId)) {
        acc.push(participant);
      }
      return acc;
    }, []);
  };

  useEffect(() => {
    if (!id) return;

    const userName = user?.name || localStorage.getItem('userName') || 'Guest';
    console.log('Joining room', id, 'as', userName);
    const socket = joinRoom(id, userName);

    socket.on('connect', () => {
      console.log('Connected to server', socket.id);
    });
    socket.on('connect_error', (err: any) => {
      console.error('Socket connect_error', err);
    });

    socket.on('existing-participants', (data: any) => {
      console.log('All users in room', id, 'count=', data?.length, data);
      // Filter out ourselves (server includes the joining user in the list)
      const filtered = dedupeParticipants(
        data.filter((p: any) => p.socketId !== socket.id)
      );
      console.log('Filtered participants (without self):', filtered.map((p: any) => p.socketId));
      setParticipants(filtered);

      // Create peer connections to existing participants (we initiate)
      filtered.forEach((p: any) => {
        if (p.socketId === socket.id) return;
        if (!peersRef.current.has(p.socketId)) {
          createPeer(p.socketId, true, socket);
        }
      });
    });

    socket.on('user-joined', (data: any) => {
      console.log('user-joined event', data);
      if (data.socketId === socket.id) return;
      setParticipants((prev) => {
        const next = dedupeParticipants([...prev, data]);
        console.log('Participants after join:', next.map((p: any) => p.socketId));
        return next;
      });
      // Existing participants should not initiate offers for the new user.
      // The newly joined participant will create offers to existing users.
    });

    socket.on('user-left', (data: any) => {
      console.log('user-left event', data);
      setParticipants((prev) => prev.filter((p) => p.socketId !== data.socketId));
      console.log('Participants after leave:', participants.map((p: any) => p.socketId));
      // cleanup peer and refs
      const pc = peersRef.current.get(data.socketId);
      if (pc) {
        try { pc.close(); } catch (e) {}
        peersRef.current.delete(data.socketId);
      }
      if (remoteVideoRefs.current[data.socketId]) {
        try { remoteVideoRefs.current[data.socketId]!.srcObject = null; } catch (e) {}
        delete remoteVideoRefs.current[data.socketId];
      }
    });

    socket.on('disconnect', () => {
      console.log('socket disconnected');
    });

    return () => {
      socket.off('connect');
      socket.off('existing-participants');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('disconnect');
      leaveRoom();
    };
  }, [id, user]);

  // Socket signaling handlers (handle incoming offers/answers/candidates)
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();

    const drainIceCandidates = async (peerId: string, pc: RTCPeerConnection) => {
      const queued = iceCandidateQueueRef.current[peerId] || [];
      if (!queued.length) return;

      console.log('Draining', queued.length, 'queued ICE candidates for', peerId);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Failed to add queued ICE candidate', err, candidate);
        }
      }
      iceCandidateQueueRef.current[peerId] = [];
    };

    const onOffer = async ({ from, offer }: any) => {
      console.log('Received offer from', from);
      let peer = peersRef.current.get(from);
      if (!peer) peer = await createPeer(from, false, socket);
      if (peer.signalingState !== 'stable') {
        console.warn('Ignoring offer because peer is not stable:', peer.signalingState);
        return;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('Remote SDP (offer) set for', from, '\n', peer.remoteDescription?.sdp?.split('\n').slice(0,10).join('\n'));
      console.log('Receivers after setting remote offer:', peer.getReceivers().map(r=>({id:r.track?.id, kind: r.track?.kind})));
      console.log('Transceivers after setting remote offer:', peer.getTransceivers().map(t=>({mid:t.mid,direction:t.direction})));
      await drainIceCandidates(from, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      console.log('Local SDP (answer) for', from, '\n', peer.localDescription?.sdp?.split('\n').slice(0,10).join('\n'));
      console.log('Sending answer to', from);
      socket.emit('answer', { to: from, answer });
    };

    const onAnswer = async ({ from, answer }: any) => {
      console.log('Received answer from', from);
      const peer = peersRef.current.get(from);
      if (!peer) return;
      console.log('Peer signaling state before answer:', peer.signalingState);
      if (peer.signalingState !== 'have-local-offer' && peer.signalingState !== 'have-remote-pranswer') {
        console.warn('Ignoring answer because peer is in wrong state:', peer.signalingState);
        return;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Remote SDP (answer) set for', from, '\n', peer.remoteDescription?.sdp?.split('\n').slice(0,10).join('\n'));
      console.log('Receivers after setting remote answer:', peer.getReceivers().map(r=>({id:r.track?.id, kind: r.track?.kind})));
      console.log('Transceivers after setting remote answer:', peer.getTransceivers().map(t=>({mid:t.mid,direction:t.direction})));
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

    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIce);

    return () => {
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIce);
    };
  }, [id, user]);

  useEffect(() => {
    const startMedia = async () => {
      if (!isCameraOn && !isMicOn) {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: isCameraOn,
          audio: isMicOn,
        };

        console.log('Requesting media with constraints', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = stream;
        console.log('Obtained local stream tracks:', stream.getTracks().map(t => t.kind));

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(() => {});
        }
      } catch (error) {
        console.error('Media error:', error);
      }
    };

    startMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [isCameraOn, isMicOn]);

  // When local stream changes, replace tracks on existing peer connections
  useEffect(() => {
    peersRef.current.forEach((peer) => {
      try {
        const senders = peer.getSenders();
        senders.forEach((sender) => {
          if (!sender.track) return;
          const kind = sender.track.kind;
          const newTrack = localStreamRef.current?.getTracks().find((t) => t.kind === kind) || null;
          if (newTrack) {
            sender.replaceTrack(newTrack).catch(() => {});
          }
        });
      } catch (err) {
        // ignore
      }
    });
  }, [isCameraOn, isMicOn]);

  // Helper to create a peer connection
  async function createPeer(peerId: string, isInitiator: boolean, socket: any) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    peersRef.current.set(peerId, pc);

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current as MediaStream));
      console.log('createPeer:', peerId, 'added local tracks:', localStreamRef.current.getTracks().map(t => t.kind));
      console.log('createPeer:', peerId, 'senders after addTrack:', pc.getSenders().map(s => ({id: s.track?.id, kind: s.track?.kind})));
      console.log('createPeer:', peerId, 'transceivers:', pc.getTransceivers().map(t => ({mid: t.mid, direction: t.direction, receiver: !!t.receiver})));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('pc.onicecandidate -> sending candidate for', peerId, event.candidate && event.candidate.candidate?.substring(0,80));
        socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      const kinds = stream.getTracks().map(t => t.kind);
      const id = stream.id;
      console.log('pc.ontrack from', peerId, 'streamId=', id, 'tracks=', kinds);
      // store stream so we can attach when element mounts
      remoteStreamsRef.current[peerId] = stream;
      const videoEl = remoteVideoRefs.current[peerId];
      if (videoEl) {
        try {
          videoEl.srcObject = stream;
          videoEl.play().then(() => {
            console.log('video.play() succeeded for', peerId, 'streamId=', id);
          }).catch((err) => {
            console.warn('video.play() failed for', peerId, err);
          });
        } catch (e) {
          console.warn('Error attaching stream to video element for', peerId, e);
        }
      } else {
        console.log('video element not mounted yet for', peerId, 'stream stored');
      }
      // Trigger re-render to show video element if needed
      setParticipants((prev) => [...prev]);
    };

    pc.onconnectionstatechange = () => {
      console.log('pc.onconnectionstatechange', peerId, pc.connectionState, 'ice=', pc.iceConnectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        try { pc.close(); } catch (e) {}
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
        console.log('Local SDP (offer) for', peerId, '\n', pc.localDescription?.sdp?.split('\n').slice(0,10).join('\n'));
        socket.emit('offer', { to: peerId, offer });
      } catch (err) {
        console.error('Offer error', err);
      }
    }

    return pc;
  }

  return (
    <Flex direction="column" h="100vh" bg="gray.900" color="white">
      {/* Main Grid */}
      <Box flex="1" p={4} overflow="hidden">
        <Grid templateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap={4} h="full">
          <GridItem bg="gray.800" borderRadius="xl" position="relative" overflow="hidden" minH="320px">
            <video ref={localVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
            {!isCameraOn && (
              <Flex position="absolute" inset={0} align="center" justify="center" bg="blackAlpha.700">
                <Text fontSize="xl" color="white">Camera is off</Text>
              </Flex>
            )}
            <Box position="absolute" bottom={4} left={4} bg="blackAlpha.600" px={3} py={1} borderRadius="md">
              <Text fontSize="sm">{user?.name || localStorage.getItem('userName') || 'You'} (You)</Text>
            </Box>
          </GridItem>

          {participants.map((p) => {
            const hasStream = !!remoteVideoRefs.current[p.socketId]?.srcObject;
            return (
              <GridItem key={p.socketId} bg="gray.800" borderRadius="xl" position="relative" display="flex" alignItems="center" justifyContent="center" overflow="hidden">
                <video
                  ref={(el) => {
                    remoteVideoRefs.current[p.socketId] = el;
                    if (el) {
                      const s = remoteStreamsRef.current[p.socketId];
                      if (s) {
                        try {
                          el.srcObject = s;
                          el.play().then(() => console.log('Attached and started video element for', p.socketId)).catch((e) => console.warn('Auto-play failed on attach for', p.socketId, e));
                        } catch (e) {
                          console.warn('Failed to attach stored stream to video element for', p.socketId, e);
                        }
                      }
                    }
                  }}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  playsInline
                  autoPlay
                  muted
                />
                {!hasStream && <Avatar size="2xl" name={p.userName} />}
                <Box position="absolute" bottom={4} left={4} bg="blackAlpha.600" px={3} py={1} borderRadius="md">
                  <Text fontSize="sm">{p.userName}</Text>
                </Box>
              </GridItem>
            );
          })}
        </Grid>
      </Box>

      {/* Control Bar */}
      <Flex h="80px" bg="gray.900" borderTop="1px solid" borderColor="gray.800" align="center" justify="space-between" px={6}>
        <Text color="gray.400">12:00 PM | abc-defg-hij</Text>

        <HStack spacing={4}>
          <IconButton
            aria-label="Toggle Mic"
            icon={isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
            colorScheme={isMicOn ? "gray" : "red"}
            isRound
            onClick={toggleMic}
          />
          <IconButton
            aria-label="Toggle Camera"
            icon={isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
            colorScheme={isCameraOn ? "gray" : "red"}
            isRound
            onClick={toggleCamera}
          />
          <IconButton aria-label="Share Screen" icon={<MonitorUp size={20} />} colorScheme="gray" isRound />
          <IconButton aria-label="Raise Hand" icon={<Hand size={20} />} colorScheme="gray" isRound />
          <IconButton aria-label="Leave" icon={<PhoneOff size={20} />} colorScheme="red" isRound onClick={() => navigate('/')} />
        </HStack>

        <HStack spacing={4}>
          <IconButton aria-label="Participants" icon={<Users size={20} />} variant="ghost" color="gray.400" _hover={{ color: "white" }} />
          <IconButton aria-label="Chat" icon={<MessageSquare size={20} />} variant="ghost" color="gray.400" _hover={{ color: "white" }} />
          <IconButton aria-label="Settings" icon={<Settings size={20} />} variant="ghost" color="gray.400" _hover={{ color: "white" }} />
        </HStack>
      </Flex>
    </Flex>
  );
}
