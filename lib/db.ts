import { MongoClient, type Db } from "mongodb";
import type { LogEntry, Reading } from "@/types";

// Shared MongoDB client, cached on globalThis so dev hot reloads don't open new pools.
const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI must be set in .env");
  if (!globalForMongo._mongoClientPromise) {
    globalForMongo._mongoClientPromise = new MongoClient(uri).connect();
  }
  return globalForMongo._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB ?? "water-copilot");
}

/** Close the shared client. Only needed by scripts; the Next.js server keeps it open. */
export async function closeDb(): Promise<void> {
  if (!globalForMongo._mongoClientPromise) return;
  const client = await globalForMongo._mongoClientPromise;
  globalForMongo._mongoClientPromise = undefined;
  await client.close();
}

export const collections = {
  readings: "readings",
  logs: "logs",
  handoffs: "handoffs",
} as const;

// Results never include Mongo's _id so they match the shared data formats.
const noId = { projection: { _id: 0 } } as const;

export async function addReading(reading: Reading): Promise<Reading> {
  const db = await getDb();
  // Copy: insertOne mutates its argument by adding _id.
  await db.collection<Reading>(collections.readings).insertOne({ ...reading });
  return reading;
}

/** Most recent first. */
export async function getReadings(plant_id: string, limit = 30): Promise<Reading[]> {
  const db = await getDb();
  return db
    .collection<Reading>(collections.readings)
    .find({ plant_id }, noId)
    .sort({ date: -1 })
    .limit(limit)
    .toArray();
}

export async function addLog(log: LogEntry): Promise<LogEntry> {
  const db = await getDb();
  await db.collection<LogEntry>(collections.logs).insertOne({ ...log });
  return log;
}

/** Most recent first. */
export async function getLogs(plant_id: string, limit = 20): Promise<LogEntry[]> {
  const db = await getDb();
  return db
    .collection<LogEntry>(collections.logs)
    .find({ plant_id }, noId)
    .sort({ date: -1 })
    .limit(limit)
    .toArray();
}

export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection(collections.readings).createIndex({ plant_id: 1, date: -1 }),
    db.collection(collections.logs).createIndex({ plant_id: 1, date: -1 }),
  ]);
}
