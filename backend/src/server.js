import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import articleRoutes from "./routes/articles.js";
import categoryRoutes from "./routes/categories.js";
import adminRoutes from "./routes/admin.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "news-backend",
    database: "configured",
    timestamp: new Date().toISOString()
  });
});

app.get("/api", (_req, res) => {
  res.json({ name: "News App API", version: "0.1.0" });
});

app.use("/api/articles", articleRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/admin", adminRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`News API listening on port ${port}`);
});
