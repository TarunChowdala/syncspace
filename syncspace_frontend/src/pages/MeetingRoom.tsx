import { Box, Flex, HStack, IconButton, Grid, GridItem, Text, Avatar } from '@chakra-ui/react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, MessageSquare, MonitorUp, Settings, Hand } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { leaveRoom } from '../services/socket';
import { keyframes } from '@emotion/react';

import { useMeetingMedia } from '../hooks/useMeetingMedia';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMeetingSocket } from '../hooks/useMeetingSocket';
import { useAudioDetector } from '../hooks/useAudioDetector';

const pulse = keyframes`
  0% { box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.5), 0 0 10px 2px rgba(74, 222, 128, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.8), 0 0 16px 4px rgba(74, 222, 128, 0.6); }
  100% { box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.5), 0 0 10px 2px rgba(74, 222, 128, 0.4); }
`;

export default function MeetingRoom() {
  const { isMicOn, isCameraOn, toggleMic, toggleCamera, user } = useStore();
  const navigate = useNavigate();
  const { id } = useParams();

  const { localStreamRef, localVideoRef, mediaReady } = useMeetingMedia();

  const {
    peersRef,
    remoteVideoRefs,
    iceCandidateQueueRef,
    createPeer,
    removePeer,
    remoteVideoStates,
    replaceTracks,
    remoteStreamsRef,
    broadcastVideoState,
    handleRemoteVideoState,
  } = useWebRTC(localStreamRef);

  const {
    participants,
    drainPendingInitiators
  } = useMeetingSocket(
    id,
    user,
    localStreamRef,
    createPeer,
    removePeer,
    peersRef,
    iceCandidateQueueRef,
    handleRemoteVideoState
  );

  const { isSpeaking } = useAudioDetector(localStreamRef, isMicOn);

  useEffect(() => {
    if (mediaReady) {
      replaceTracks();
      drainPendingInitiators();
    }
  }, [mediaReady, replaceTracks, drainPendingInitiators]);

  // Notify remote peers when our camera is toggled
  useEffect(() => {
    if (mediaReady) {
      broadcastVideoState(isCameraOn);
    }
  }, [isCameraOn, mediaReady, broadcastVideoState]);

  const handleLeaveCall = async () => {
    try {
      peersRef.current.forEach((pc, peerId) => {
        try {
          pc.close();
          console.log('Closed peer connection with', peerId);
        } catch (e) {
          console.error('Error closing peer connection:', e);
        }
      });
      peersRef.current.clear();

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

      leaveRoom();
      console.log('Left room and disconnected from socket');
      navigate('/');
    } catch (error) {
      console.error('Error during leave call:', error);
      navigate('/');
    }
  };

  console.log(isMicOn, "ismicon", isSpeaking, "isspeaking");

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
            isRound
            colorScheme={isMicOn ? "gray" : "red"}
            animation={isMicOn && isSpeaking ? `${pulse} 1.5s infinite` : "none"}
            onClick={toggleMic}
            boxShadow={isSpeaking ? "0 0 10px rgba(74, 222, 128, 0.7)" : "none"}
            transition="all 0.1s"
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
