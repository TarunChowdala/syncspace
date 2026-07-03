import { Box, Button, Flex, Heading, Text, VStack, HStack, IconButton } from '@chakra-ui/react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

export default function Lobby() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { isMicOn, isCameraOn, toggleMic, toggleCamera } = useStore();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const startMedia = async () => {
      if (!isCameraOn && !isMicOn) {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: isCameraOn,
          audio: isMicOn,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error('Lobby media error', err);
      }
    };

    startMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [isCameraOn, isMicOn]);

  return (
    <Flex minH="100vh" bg="gray.900" align="center" justify="center" p={4}>
      <Flex direction={['column', 'row']} w="full" maxW="1000px" gap={8}>
        {/* Video Preview */}
        <Box flex="2" bg="black" borderRadius="xl" overflow="hidden" position="relative" minH="400px" display="flex" alignItems="center" justifyContent="center">
          <video ref={localVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          {!isCameraOn && (
            <Flex position="absolute" inset={0} align="center" justify="center" bg="blackAlpha.700">
              <Text color="gray.500" fontSize="2xl">Camera is off</Text>
            </Flex>
          )}

          <HStack position="absolute" bottom={6} left="50%" transform="translateX(-50%)" spacing={4}>
            <IconButton
              aria-label="Toggle Mic"
              icon={isMicOn ? <Mic /> : <MicOff />}
              colorScheme={isMicOn ? "gray" : "red"}
              isRound
              size="lg"
              onClick={toggleMic}
            />
            <IconButton
              aria-label="Toggle Camera"
              icon={isCameraOn ? <Video /> : <VideoOff />}
              colorScheme={isCameraOn ? "gray" : "red"}
              isRound
              size="lg"
              onClick={toggleCamera}
            />
          </HStack>
        </Box>

        {/* Meeting Info */}
        <VStack flex="1" align="center" justify="center" bg="gray.800" p={8} borderRadius="xl" spacing={6}>
          <Heading size="lg" color="white">Ready to join?</Heading>
          <Text color="gray.400" textAlign="center">Meeting ID: {id}</Text>
          <Button size="lg" colorScheme="brand" w="full" onClick={() => navigate(`/meeting/${id}`)}>
            Join Now
          </Button>
          <Button variant="ghost" colorScheme="gray" w="full" onClick={() => navigate('/')}>
            Cancel
          </Button>
        </VStack>
      </Flex>
    </Flex>
  );
}
