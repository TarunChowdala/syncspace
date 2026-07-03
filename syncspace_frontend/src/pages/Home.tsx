import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Text,
  VStack,
  HStack,
  Stack,
  SimpleGrid,
  InputGroup,
  InputLeftElement,
  FormControl,
  FormLabel,
  useToast,
} from '@chakra-ui/react';
import { Video, Keyboard, User, Hash } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { nanoid } from 'nanoid';
import { useStore } from '../store/useStore';

export default function Home() {
  const { setUser } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');

  const joinRoom = () => {
    const name = joinName.trim();
    if (!code.trim() || !name) {
      toast({
        title: 'Missing information',
        description: 'Enter your name and room code before joining.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
      return;
    }

    setUser({ name, email: '' });
    localStorage.setItem('userName', name);
    navigate(`/lobby/${code.trim()}`);
  };

  const createRoom = () => {
    const name = createName.trim();
    if (!name) {
      toast({
        title: 'Missing name',
        description: 'Enter your name before creating a room.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
      return;
    }

    const roomId = `syncspace:${nanoid(5)}`;
    setUser({ name, email: '' });
    localStorage.setItem('userName', name);
    navigate(`/lobby/${roomId}`);
  };

  return (
    <Box minH="100vh" bg="gray.950" color="white" pt={4} px={[4, 6, 12]}>
      <Flex as="nav" justify="space-between" align="center" mb={10}>
        <HStack spacing={3}>
          <Video color="#1e90ff" size={32} />
          <VStack spacing={0} align="flex-start">
            <Heading size="md" color="white">SyncSpace</Heading>
            <Text fontSize="sm" color="gray.400">Modern team meetings with live rooms</Text>
          </VStack>
        </HStack>
        <HStack spacing={4}>
          <Text color="gray.400" fontSize="sm">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date().toLocaleDateString()}
          </Text>
          <Button colorScheme="brand" variant="outline" onClick={() => navigate('/login')}>
            Login
          </Button>
        </HStack>
      </Flex>

      <Flex direction={['column', 'column', 'row']} align="stretch" justify="space-between" gap={12}>
        <Box flex="1" w="full">
          <VStack align="stretch" spacing={8}>
            <Heading size="2xl" lineHeight="1.1">
              Premium video meetings. Now free for everyone.
            </Heading>
          

            <SimpleGrid columns={[1, 1, 2]} spacing={6}>
              <Box bg="gray.900" p={6} borderRadius="2xl" border="1px solid" borderColor="gray.800">
                <HStack justify="space-between" mb={4}>
                  <VStack align="flex-start" spacing={1}>
                    <Text fontSize="sm" color="brand.400" fontWeight="bold">
                      New room
                    </Text>
                    <Heading size="md">Create room</Heading>
                  </VStack>
                  <Badge colorScheme="brand">Fast</Badge>
                </HStack>
                <Text color="gray.400" mb={6}>
                  Generate a new meeting room instantly and invite others using the room code.
                </Text>
                <FormControl>
                  <InputGroup>
                    <InputLeftElement pointerEvents="none">
                      <User color="#9ca3af" />
                    </InputLeftElement>
                    <Input
                      bg="gray.800"
                      border="1px solid"
                      borderColor="gray.700"
                      placeholder="Your name"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      _placeholder={{ color: 'gray.500' }}
                    />
                  </InputGroup>
                </FormControl>
                <Button marginTop={4} w="full" size="lg" colorScheme="brand" leftIcon={<Video size={20} />} onClick={createRoom} isDisabled={!createName.trim()}>
                  Create room
                </Button>
              </Box>

              <Box bg="gray.900" p={6} borderRadius="2xl" border="1px solid" borderColor="gray.800">
                <HStack justify="space-between" mb={4}>
                  <VStack align="flex-start" spacing={1}>
                    <Text fontSize="sm" color="brand.400" fontWeight="bold">
                      Join room
                    </Text>
                    <Heading size="md">Enter code</Heading>
                  </VStack>
                  <Badge colorScheme="purple">Secure</Badge>
                </HStack>
                <Text color="gray.400" mb={6}>
                  Enter your room code and name to join an active meeting.
                </Text>
                <Stack spacing={4}>
                  <FormControl>
                    <InputGroup>
                      <InputLeftElement pointerEvents="none">
                        <Hash color="#9ca3af" />
                      </InputLeftElement>
                      <Input
                        bg="gray.800"
                        border="1px solid"
                        borderColor="gray.700"
                        placeholder="Room code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        _placeholder={{ color: 'gray.500' }}
                      />
                    </InputGroup>
                  </FormControl>
                  <FormControl>
                    <InputGroup>
                      <InputLeftElement pointerEvents="none">
                        <User color="#9ca3af" />
                      </InputLeftElement>
                      <Input
                        bg="gray.800"
                        border="1px solid"
                        borderColor="gray.700"
                        placeholder="Your name"
                        value={joinName}
                        onChange={(e) => setJoinName(e.target.value)}
                        _placeholder={{ color: 'gray.500' }}
                      />
                    </InputGroup>
                  </FormControl>
                  <Button w="full" size="lg" variant="outline" colorScheme="brand" onClick={joinRoom} isDisabled={!code.trim() || !joinName.trim()}>
                    Join room
                  </Button>
                </Stack>
              </Box>
            </SimpleGrid>

          </VStack>
        </Box>
      </Flex>
    </Box>
  );
}
