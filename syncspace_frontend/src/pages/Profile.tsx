import { Box, Container, Heading, Text } from '@chakra-ui/react';

export default function Profile() {
  return (
    <Container centerContent minH="100vh" justifyContent="center">
      <Box p={8} bg="gray.800" borderRadius="lg" w="full" maxW="md">
        <Heading size="md" color="white" mb={4}>User Profile</Heading>
        <Text color="gray.400">Profile functionality coming soon.</Text>
      </Box>
    </Container>
  );
}
