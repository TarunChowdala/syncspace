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
  const [remoteVideoStates, setRemoteVideoStates] = useState<Record<string, boolean>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream | null>>({});
  const pendingInitiatorQueueRef = useRef<string[]>([]);

  const dedupeParticipants = (participants: any[]) => {
    return participants.reduce((acc: any[], participant) => {
      if (!acc.some((p) => p.socketId === participant.socketId)) {
        acc.push(participant);
      }
      return acc;
    }, []);
  };

  const handleLeaveCall = async () => {
    try {
      // Close all peer connections
      peersRef.current.forEach((pc, peerId) => {
        try {
          pc.close();
          console.log('Closed peer connection with', peerId);
        } catch (e) {
          console.error('Error closing peer connection:', e);
        }
      });
      peersRef.current.clear();

      // Stop all local media tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
            console.log('Stopped local track:', track.kind);
          } catch (e) {
            console.error('Error stopping local track:', e);
          }
        });
        localStreamRef.current = null;
      }

      // Clear all remote video elements and streams
      Object.keys(remoteVideoRefs.current).forEach((peerId) => {
        try {
          if (remoteVideoRefs.current[peerId]) {
            remoteVideoRefs.current[peerId]!.srcObject = null;
          }
          delete remoteVideoRefs.current[peerId];
        } catch (e) {
          console.error('Error clearing remote video:', e);
        }
      });

      Object.keys(remoteStreamsRef.current).forEach((peerId) => {
        delete remoteStreamsRef.current[peerId];
      });

      // Disconnect socket and leave room
      leaveRoom();
      console.log('Left room and disconnected from socket');

      // Navigate back to home
      navigate('/');
    } catch (error) {
      console.error('Error during leave call:', error);
      // Still navigate even if there's an error
      navigate('/');
    }
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
      console.log('Existing participants count=', data?.length);
      // Filter out ourselves (server includes the joining user in the list)
      const filtered = dedupeParticipants(
        data.filter((p: any) => p.socketId !== socket.id)
      );
      setParticipants(filtered);

      // Create peer connections to existing participants (we initiate)
      // If local media isn't ready yet, queue initiator creation and drain later.
      filtered.forEach((p: any) => {
        if (p.socketId === socket.id) return;
        if (peersRef.current.has(p.socketId)) return;
        if (localStreamRef.current) {
          createPeer(p.socketId, true, socket);
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
          console.warn('Failed to add queued ICE candidate', err);
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
      try {
        const constraints: MediaStreamConstraints = {
          video: isCameraOn,
          audio: isMicOn,
        };

        console.log('Requesting media with constraints', constraints);
        
        // Stop existing tracks
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            track.stop();
          });
        }

        // Only get new media if at least one is enabled
        if (isCameraOn || isMicOn) {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          localStreamRef.current = stream;
          console.log('Obtained local stream tracks:', stream.getTracks().map(t => `${t.kind}(${t.enabled})`));

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
            localVideoRef.current.play().catch(() => {});
            
            // If we queued initiator peers while waiting for media, create them now
            const queued = pendingInitiatorQueueRef.current.splice(0);
            if (queued.length) {
              const socket = getSocket();
              console.log('Draining', queued.length, 'queued initiator peers after media ready', queued);
              queued.forEach((peerId) => {
                if (!peersRef.current.has(peerId)) {
                  createPeer(peerId, true, socket);
                  console.log('Draining queued initiator peer', peerId);
                }
              });
            }
          }
        } else {
          // Both camera and mic are off
          localStreamRef.current = null;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
          }
        }
      } catch (error) {
        console.error('Media error:', error);
      }
    };

    startMedia();

    return () => {
      // Don't stop tracks here - let the next call handle cleanup
    };
  }, [isCameraOn, isMicOn]);

  // When local stream changes, update tracks on existing peer connections
  useEffect(() => {
    console.log('Track management effect triggered - isMicOn:', isMicOn, 'isCameraOn:', isCameraOn);
    
    peersRef.current.forEach((peer, peerId) => {
      try {
        const senders = peer.getSenders();
        
        // Handle video track
        const videoSender = senders.find((s) => {
          try { return s.track?.kind === 'video'; } catch { return false; }
        });
        const newVideoTrack = isCameraOn 
          ? localStreamRef.current?.getTracks().find((t) => t.kind === 'video') || null 
          : null;
        
        if (videoSender) {
          videoSender.replaceTrack(newVideoTrack).then(() => {
            console.log('Video track replaced for peer', peerId, '- new track:', newVideoTrack ? 'present' : 'null');
          }).catch((err) => {
            console.warn('Failed to replace video track:', err);
          });
        } else if (newVideoTrack && localStreamRef.current) {
          // Add video track if it doesn't exist as a sender
          peer.addTrack(newVideoTrack, localStreamRef.current);
          console.log('Video track added for peer', peerId);
        }
        
        // Handle audio track
        const audioSender = senders.find((s) => {
          try { return s.track?.kind === 'audio'; } catch { return false; }
        });
        const newAudioTrack = isMicOn 
          ? localStreamRef.current?.getTracks().find((t) => t.kind === 'audio') || null 
          : null;
        
        if (audioSender) {
          audioSender.replaceTrack(newAudioTrack).then(() => {
            console.log('Audio track replaced for peer', peerId, '- new track:', newAudioTrack ? 'present' : 'null');
          }).catch((err) => {
            console.warn('Failed to replace audio track:', err);
          });
        } else if (newAudioTrack && localStreamRef.current) {
          // Add audio track if it doesn't exist as a sender
          peer.addTrack(newAudioTrack, localStreamRef.current);
          console.log('Audio track added for peer', peerId);
        }
      } catch (err) {
        console.error('Error updating tracks for peer', peerId, ':', err);
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

    // Add local tracks if available
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current as MediaStream);
      });
      console.log('createPeer:', peerId, 'added local tracks from stream');
    } else {
      // If no local stream yet, add dummy transceivers so SDP includes m=audio and m=video
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
      const id = stream.id;
      console.log('pc.ontrack from', peerId, 'streamId=', id, 'track kind=', event.track.kind, 'enabled=', event.track.enabled);
      
      // Update video state tracking
      if (event.track.kind === 'video') {
        setRemoteVideoStates((prev) => ({ ...prev, [peerId]: event.track.enabled }));
        
        // Listen for track enable/disable changes
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
      
      // store stream so we can attach when element mounts
      remoteStreamsRef.current[peerId] = stream;
      const videoEl = remoteVideoRefs.current[peerId];
      if (videoEl) {
        try {
          videoEl.srcObject = stream;
          videoEl.play().then(() => {
            console.log('video.play() succeeded for', peerId);
          }).catch((err) => {
            console.warn('video.play() failed for', peerId, err);
          });
        } catch (e) {
          console.warn('Error attaching stream to video element for', peerId, e);
        }
      } else {
        console.log('video element not mounted yet for', peerId);
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
        const hasMVideo = !!pc.localDescription?.sdp?.includes('\nm=video');
        const hasMaudio = !!pc.localDescription?.sdp?.includes('\nm=audio');
        console.log('Local offer created for', peerId, 'm=video=', hasMVideo, 'm=audio=', hasMaudio);
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
            <video 
              ref={localVideoRef} 
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: isCameraOn ? 'block' : 'none' }} 
              muted 
              playsInline 
            />
            {!isCameraOn && (
              <Flex position="absolute" inset={0} align="center" justify="center" bg="blackAlpha.700" flexDirection="column">
                <Avatar size="2xl" name={user?.name || localStorage.getItem('userName') || 'You'} mb={4} />
                <Text fontSize="xl" color="white">Camera is off</Text>
              </Flex>
            )}
            <Box position="absolute" bottom={4} left={4} bg="blackAlpha.600" px={3} py={1} borderRadius="md">
              <Text fontSize="sm">{user?.name || localStorage.getItem('userName') || 'You'} (You)</Text>
            </Box>
          </GridItem>

          {participants.map((p) => {
            const hasStream = !!remoteVideoRefs.current[p.socketId]?.srcObject;
            const videoEnabled = remoteVideoStates[p.socketId] !== false;
            const showVideo = hasStream && videoEnabled;
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
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: showVideo ? 'block' : 'none' }}
                  playsInline
                  autoPlay
                  muted
                />
                {!showVideo && <Avatar size="2xl" name={p.userName} />}
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
          <IconButton aria-label="Leave" icon={<PhoneOff size={20} />} colorScheme="red" isRound onClick={handleLeaveCall} />
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
