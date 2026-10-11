import { MongoClient, Db, Collection } from "mongodb";
import type {
  Reading,
  LogEntry,
  ManualChunk,
  ManualHit,
  Emergency,
  TimelineEvent,
  NotificationStatus,
} from "./types";
import { embed } from "./llm";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "chena_copilot";

// Reuse the client across hot reloads / serverless invocations.
let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(dbName);
}

export async function readings(): Promise<Collection<Reading>> {
  return (await getDb()).collection<Reading>("readings");
}

export async function logs(): Promise<Collection<LogEntry>> {
  return (await getDb()).collection<LogEntry>("logs");
}

export async function manualChunks(): Promise<Collection<ManualChunk>> {
  return (await getDb()).collection<ManualChunk>("manual_chunks");
}

// ---- Readings ----

export async function getReadings(
  plantId: string,
  limit = 90
): Promise<Reading[]> {
  const col = await readings();
  const docs = await col
    .find({ plant_id: plantId }, { projection: { _id: 0 } })
    .sort({ date: 1 })
    .toArray();
  // Return the most recent `limit`, oldest-first.
  return docs.slice(-limit);
}

export async function addReading(r: Reading): Promise<void> {
  const col = await readings();
  await col.updateOne(
    { plant_id: r.plant_id, date: r.date },
    { $set: r },
    { upsert: true }
  );
}

// ---- Logs ----

export async function getLogs(
  plantId: string,
  limit = 200
): Promise<LogEntry[]> {
  const col = await logs();
  return col
    .find({ plant_id: plantId }, { projection: { _id: 0 } })
    .sort({ date: -1 })
    .limit(limit)
    .toArray();
}

export async function addLog(entry: LogEntry): Promise<void> {
  const col = await logs();
  await col.insertOne(entry);
}

// Keyword search over the logbook ("what fixed this last time?").
export async function searchLogs(
  plantId: string,
  query: string,
  limit = 5
): Promise<LogEntry[]> {
  const col = await logs();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);
  const all = await col
    .find({ plant_id: plantId }, { projection: { _id: 0 } })
    .sort({ date: -1 })
    .toArray();

  const scored = all
    .map((log) => {
      const hay = `${log.problem} ${log.steps_taken} ${(log.tags || []).join(
        " "
      )}`.toLowerCase();
      const score = terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
      return { log, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.log);
}

// ---- Manual vector search (MongoDB track) ----

const VECTOR_INDEX = "manual_vector_index";

/**
 * Vector search over manual_chunks. Tries the Atlas $vectorSearch aggregation
 * first (the real MongoDB track story). If the index/stage is unavailable
 * (e.g. local mongod without Atlas Search), falls back to loading embeddings
 * and ranking by cosine similarity in-process so the demo still works offline.
 */
export async function searchManual(
  plantId: string,
  query: string,
  k = 4
): Promise<ManualHit[]> {
  const col = await manualChunks();
  const queryVec = await embed(query);

  // Attempt Atlas Vector Search.
  try {
    const results = await col
      .aggregate<ManualHit>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: queryVec,
            numCandidates: 50,
            limit: k,
            filter: { plant_id: plantId },
          },
        },
        {
          $project: {
            _id: 0,
            plant_id: 1,
            page: 1,
            heading: 1,
            text: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();
    if (results.length > 0) return results;
  } catch {
    // $vectorSearch not available — fall through to in-process cosine.
  }

  const chunks = await col
    .find({ plant_id: plantId })
    .project<ManualChunk>({ _id: 0 })
    .toArray();

  return chunks
    .filter((c) => Array.isArray(c.embedding))
    .map((c) => ({ ...c, score: cosine(queryVec, c.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---- Emergencies ----

export async function emergencies(): Promise<Collection<Emergency>> {
  return (await getDb()).collection<Emergency>("emergencies");
}

export async function createEmergency(e: Emergency): Promise<void> {
  const col = await emergencies();
  await col.insertOne(e);
}

export async function getActiveEmergency(
  plantId: string
): Promise<Emergency | null> {
  const col = await emergencies();
  return col.findOne(
    { plant_id: plantId, status: "active" },
    { projection: { _id: 0 }, sort: { declared_at: -1 } }
  );
}

export async function getEmergency(
  incidentId: string
): Promise<Emergency | null> {
  const col = await emergencies();
  return col.findOne({ incident_id: incidentId }, { projection: { _id: 0 } });
}

export async function listEmergencies(
  plantId: string,
  limit = 20
): Promise<Emergency[]> {
  const col = await emergencies();
  return col
    .find({ plant_id: plantId }, { projection: { _id: 0 } })
    .sort({ declared_at: -1 })
    .limit(limit)
    .toArray();
}

export async function appendTimeline(
  incidentId: string,
  event: TimelineEvent
): Promise<void> {
  const col = await emergencies();
  await col.updateOne(
    { incident_id: incidentId },
    { $push: { timeline: event } }
  );
}

export async function acknowledgeAgency(
  incidentId: string,
  agencyId: string,
  status: NotificationStatus = "acknowledged"
): Promise<void> {
  const col = await emergencies();
  const now = new Date().toISOString();
  await col.updateOne(
    { incident_id: incidentId, "notifications.agency_id": agencyId },
    {
      $set: {
        "notifications.$.status": status,
        "notifications.$.acknowledged_at": now,
      },
    }
  );
}

export async function standDownEmergency(
  incidentId: string,
  by: string,
  resolution: string
): Promise<void> {
  const col = await emergencies();
  const now = new Date().toISOString();
  await col.updateOne(
    { incident_id: incidentId },
    {
      $set: {
        status: "stood_down",
        stood_down_at: now,
        stood_down_by: by,
        resolution,
      },
    }
  );
}
