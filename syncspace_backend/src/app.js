import express from 'express';
import cors from 'cors';

const app = express();

const corsOptions = {
  origin: true,
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ message: 'Server is running' });
});

export default app;