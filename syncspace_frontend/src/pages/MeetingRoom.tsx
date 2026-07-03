import { Box, Flex, HStack, IconButton, Grid, GridItem, Text, Avatar } from '@chakra-ui/react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, MessageSquare, MonitorUp, Settings, Hand } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { joinRoom, leaveRoom } from '../services/socket';

export default function MeetingRoom() {
  const { isMicOn, isCameraOn, toggleMic, toggleCamera, user } = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [participants, setParticipants] = useState<any[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    if (!id) return;

    const userName = user?.name || localStorage.getItem('userName') || 'Guest';
    const socket = joinRoom(id, userName);

    socket.on('connect', () => {
      console.log('Connected to server', socket.id);
    });

    socket.on('existing-participants', (data: any) => {
      console.log('All users in room', data);
      // Filter out ourselves (server includes the joining user in the list)
      const filtered = data.filter((p: any) => p.socketId !== socket.id);
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
      console.log(data, 'user joined');
      if (data.socketId === socket.id) return;
      setParticipants((prev) => [...prev, data]);
      // New user joined -> initiate a peer connection
      if (!peersRef.current.has(data.socketId)) {
        createPeer(data.socketId, true, socket);
      }
    });

    socket.on('user-left', (data: any) => {
      console.log(data, 'user left');
      setParticipants((prev) => prev.filter((p) => p.socketId !== data.socketId));
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
    const userName = user?.name || localStorage.getItem('userName') || 'Guest';
    const socket = joinRoom(id, userName);

    const onOffer = async ({ from, offer }: any) => {
      let peer = peersRef.current.get(from);
      if (!peer) peer = await createPeer(from, false, socket);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    };

    const onAnswer = async ({ from, answer }: any) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const onIce = async ({ from, candidate }: any) => {
      const peer = peersRef.current.get(from);
      if (peer && candidate) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Failed to add ICE candidate', err);
        }
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

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = stream;

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
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      const videoEl = remoteVideoRefs.current[peerId];
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      }
      // Trigger re-render to show video element if needed
      setParticipants((prev) => [...prev]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.close();
        peersRef.current.delete(peerId);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
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
                  ref={(el) => { remoteVideoRefs.current[p.socketId] = el; }}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  playsInline
                  autoPlay
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
