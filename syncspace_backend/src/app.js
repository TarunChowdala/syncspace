import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ message: 'Server is running' });
});

export default app;