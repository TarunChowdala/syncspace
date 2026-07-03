import { Box, Button, Container, FormControl, FormLabel, Input, VStack, Heading } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';

export default function Signup() {
  const navigate = useNavigate();

  return (
    <Container centerContent minH="100vh" justifyContent="center">
      <Box w="full" maxW="md" p={8} bg="gray.800" borderRadius="lg" boxShadow="lg">
        <VStack spacing={6}>
          <Heading size="lg" color="white">Create Account</Heading>
          <FormControl>
            <FormLabel color="gray.300">Name</FormLabel>
            <Input type="text" bg="gray.700" border="none" color="white" />
          </FormControl>
          <FormControl>
            <FormLabel color="gray.300">Email</FormLabel>
            <Input type="email" bg="gray.700" border="none" color="white" />
          </FormControl>
          <FormControl>
            <FormLabel color="gray.300">Password</FormLabel>
            <Input type="password" bg="gray.700" border="none" color="white" />
          </FormControl>
          <Button w="full" colorScheme="brand" onClick={() => navigate('/login')}>Sign Up</Button>
          <Button variant="link" color="brand.400" onClick={() => navigate('/login')}>Already have an account?</Button>
        </VStack>
      </Box>
    </Container>
  );
}
