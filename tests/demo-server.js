import express from 'express';
const app = express();
app.use(express.json());
app.get('/api/test', (req, res) => res.json({ rows: [] }));
app.listen(3000);
