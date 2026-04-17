import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface Chunk {
  id: number;
  document_id: string;
  chunk_id: string;
  title: string | null;
  content: string;
  start_page: number;
  end_page: number;
  strategy: string;
  has_tables: boolean;
  has_images: boolean;
  created_at: string;
}

export interface Document {
  id: string;
  file_path: string;
  file_name: string;
  total_pages: number;
  total_chunks: number;
  created_at: string;
}

export class ChunkDatabase {
  protected db: Database.Database;
  
  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }
  
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        chunk_id TEXT UNIQUE NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        start_page INTEGER NOT NULL,
        end_page INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        has_tables INTEGER DEFAULT 0,
        has_images INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        total_pages INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_strategy ON chunks(strategy);
    `);
  }
  
  insertChunk(chunk: Omit<Chunk, 'id' | 'created_at'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (document_id, chunk_id, title, content, start_page, end_page, strategy, has_tables, has_images)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      chunk.document_id,
      chunk.chunk_id,
      chunk.title,
      chunk.content,
      chunk.start_page,
      chunk.end_page,
      chunk.strategy,
      chunk.has_tables ? 1 : 0,
      chunk.has_images ? 1 : 0
    );
  }
  
  insertDocument(doc: Document): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, file_path, file_name, total_pages, total_chunks)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(doc.id, doc.file_path, doc.file_name, doc.total_pages, doc.total_chunks);
  }
  
  getChunksByDocument(documentId: string): Chunk[] {
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY start_page');
    return stmt.all(documentId) as Chunk[];
  }
  
  getAllChunks(): Chunk[] {
    const stmt = this.db.prepare('SELECT * FROM chunks ORDER BY document_id, start_page');
    return stmt.all() as Chunk[];
  }
  
  getDocuments(): Document[] {
    const stmt = this.db.prepare('SELECT * FROM documents ORDER BY created_at DESC');
    return stmt.all() as Document[];
  }
  
  getChunkCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    const result = stmt.get() as { count: number };
    return result.count;
  }
  
  deleteChunksByDocument(documentId: string): void {
    const stmt = this.db.prepare('DELETE FROM chunks WHERE document_id = ?');
    stmt.run(documentId);
  }
  
  deleteDocument(documentId: string): void {
    const stmt = this.db.prepare('DELETE FROM documents WHERE id = ?');
    stmt.run(documentId);
  }
  
  close(): void {
    this.db.close();
  }
}

// Factory to get the appropriate database
export function getDatabase(strategy: 'fixed' | 'heading' | 'toc'): ChunkDatabase {
  const dataDir = path.join(process.cwd(), 'data');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  let dbPath: string;
  switch (strategy) {
    case 'fixed':
      dbPath = path.join(dataDir, 'fixed_chunks.db');
      break;
    case 'heading':
      dbPath = path.join(dataDir, 'heading_chunks.db');
      break;
    case 'toc':
      dbPath = path.join(dataDir, 'toc_chunks.db');
      break;
    default:
      throw new Error(`Unknown strategy: ${strategy}`);
  }
  
  return new ChunkDatabase(dbPath);
}
