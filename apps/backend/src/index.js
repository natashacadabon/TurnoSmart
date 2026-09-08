import express from 'express';
const app = express();
const PORT = Number(process.env.PORT) || 4000;
app.use(express.json());
//healthcheck
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'turnosmart-backend',
  });
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`TurnoSmart API running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map
